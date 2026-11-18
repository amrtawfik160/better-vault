import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { isLocalAppRequest, localProvidersAllowed } from "@/lib/ai/server-config";
import { isVoiceWav, maxVoiceBytes } from "@/lib/study/voice-format";

const run = promisify(execFile);
let transcribing = false;

async function usableFile(file: string, mode: number) {
  if (!isAbsolute(file)) return false;
  try {
    await access(file, mode);
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function voiceRuntime() {
  const model =
    process.env.DEEPLE_WHISPER_MODEL ??
    join(
      process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
      "deeple",
      "whisper",
      "ggml-tiny.bin",
    );
  if (!(await usableFile(model, constants.R_OK))) return;
  const name = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
  const paths = [
    ...(process.env.PATH ?? "").split(delimiter),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  const candidates = process.env.DEEPLE_WHISPER_BIN
    ? [process.env.DEEPLE_WHISPER_BIN]
    : paths.filter(isAbsolute).map((folder) => join(folder, name));
  for (const bin of new Set(candidates)) {
    if (await usableFile(bin, constants.X_OK)) return { bin, model };
  }
}

function localVoiceAllowed(request: Request) {
  return isLocalAppRequest(request) && localProvidersAllowed();
}

export async function status(request: Request) {
  return Response.json({ available: localVoiceAllowed(request) && Boolean(await voiceRuntime()) });
}

async function readRecording(request: Request) {
  if (Number(request.headers.get("content-length")) > maxVoiceBytes || !request.body) return;
  const reader = request.body.getReader();
  const bytes = new Uint8Array(maxVoiceBytes);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return bytes.subarray(0, size);
      if (size + value.byteLength > bytes.byteLength) {
        void reader.cancel().catch(() => undefined);
        return;
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function transcribe(request: Request) {
  const error = (message: string, status: number) => Response.json({ error: message }, { status });
  if (!localVoiceAllowed(request))
    return error("Local voice is available on this computer only.", 403);
  if (request.headers.get("content-type") !== "audio/wav") return error("Expected WAV audio.", 415);
  const lang = request.headers.get("x-study-language") ?? "auto";
  if (!/^(auto|[a-z]{2,3})$/.test(lang)) return error("Invalid speech language.", 400);
  if (transcribing)
    return error("A recording is already being transcribed. Try again shortly.", 409);
  transcribing = true;
  let folder: string | undefined;
  try {
    const runtime = await voiceRuntime();
    if (!runtime)
      return error("Local transcription is unavailable. Check your Whisper setup.", 503);
    const audio = await readRecording(request);
    if (!audio || !isVoiceWav(audio)) return error("Record up to 90 seconds of audio.", 400);
    folder = await mkdtemp(join(tmpdir(), "deeple-voice-"));
    const input = join(folder, "recording.wav");
    const output = join(folder, "transcript");
    await writeFile(input, audio, { mode: 0o600 });
    await run(
      runtime.bin,
      ["-m", runtime.model, "-f", input, "-l", lang, "-otxt", "-of", output, "-np", "-nt"],
      { cwd: folder, signal: request.signal, timeout: 60_000, maxBuffer: 512_000 },
    );
    const text = (await readFile(`${output}.txt`, "utf8")).trim().slice(0, 12_000);
    return Response.json({ text });
  } catch {
    return error("Could not transcribe this recording. Check local Whisper or try again.", 502);
  } finally {
    if (folder) await rm(folder, { force: true, recursive: true }).catch(() => undefined);
    transcribing = false;
  }
}
