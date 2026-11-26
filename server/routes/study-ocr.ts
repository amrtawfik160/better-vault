import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { isLocalAppRequest, localProvidersAllowed } from "@/lib/ai/server-config";
import { isOcrPng, maxOcrBytes, maxOcrText, ocrLanguage, ocrLanguages } from "@/lib/study/ocr-format";

const run = promisify(execFile);
let recognizing = false;

function local(request: Request) {
  return isLocalAppRequest(request) && localProvidersAllowed();
}

async function ocrRuntime() {
  const configured = process.env.DEEPLE_TESSERACT_BIN;
  const name = process.platform === "win32" ? "tesseract.exe" : "tesseract";
  const paths = [...(process.env.PATH ?? "").split(delimiter), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
  const candidates = configured ? [configured] : paths.filter(isAbsolute).map((path) => join(path, name));
  for (const bin of new Set(candidates)) {
    if (!isAbsolute(bin)) continue;
    try {
      await access(bin, constants.X_OK);
      if (!(await stat(bin)).isFile()) continue;
      const { stdout } = await run(bin, ["--list-langs"], { timeout: 4000, maxBuffer: 32_000 });
      const languages = [...new Set(stdout.split(/\r?\n/).map((line) => line.trim())
        .filter((code) => code !== "osd" && ocrLanguage.safeParse(code).success))];
      if (languages.length) return { bin, languages };
    } catch {
      // A PATH entry may be missing or have no installed language data.
    }
  }
}

async function readImage(request: Request) {
  if (Number(request.headers.get("content-length")) > maxOcrBytes || !request.body) return;
  const reader = request.body.getReader();
  const bytes = new Uint8Array(maxOcrBytes);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return bytes.subarray(0, size);
      if (size + value.byteLength > bytes.length) {
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

export async function status(request: Request) {
  const installed = local(request) ? await ocrRuntime() : undefined;
  return Response.json({ local: local(request), languages: installed?.languages ?? [] });
}

export async function recognize(request: Request) {
  const error = (message: string, status: number) => Response.json({ error: message }, { status });
  if (!local(request)) return error("Text recognition is available on this computer only.", 403);
  if (request.headers.get("content-type") !== "image/png") return error("Expected a PNG page image.", 415);
  const parsed = ocrLanguages.safeParse(request.headers.get("x-study-ocr-language")?.split("+"));
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length)
    return error("Choose one or two recognition languages.", 400);
  if (recognizing) return error("Another page is being recognized. Try again shortly.", 409);
  recognizing = true;
  let folder: string | undefined;
  try {
    const installed = await ocrRuntime();
    if (!installed || parsed.data.some((code) => !installed.languages.includes(code)))
      return error("The selected Tesseract language data is unavailable.", 503);
    const bytes = await readImage(request);
    if (!bytes || !isOcrPng(bytes)) return error("The page image is invalid or too large.", 400);
    request.signal.throwIfAborted();
    folder = await mkdtemp(join(tmpdir(), "deeple-ocr-"));
    const input = join(folder, "page.png");
    await writeFile(input, bytes, { mode: 0o600, signal: request.signal });
    const { stdout } = await run(installed.bin, [input, "stdout", "-l", parsed.data.join("+"), "--psm", "3"], {
      cwd: folder, signal: request.signal, timeout: 45_000, maxBuffer: 512_000,
    });
    const text = stdout.trim();
    if (text.length > maxOcrText) return error("This page has too much recognized text.", 422);
    return Response.json({ text });
  } catch {
    return error("Could not recognize this page with Tesseract.", 502);
  } finally {
    if (folder) await rm(folder, { force: true, recursive: true }).catch(() => undefined);
    recognizing = false;
  }
}
