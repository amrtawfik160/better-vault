/// <reference lib="webworker" />
import { env, KokoroTTS, TextSplitterStream } from "kokoro-js";
// The ONNX runtime's WebAssembly, served with the app instead of from a CDN.
import ortWasm from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url";
import { cpuSetup, voiceDownloaded, voiceSetup, type VoiceSetup } from "./kokoro-files";
import type { KokoroReply, KokoroRequest } from "./kokoro-protocol";
import { kokoroModel, kokoroVoice } from "./kokoro-protocol";

/**
 * Runs Kokoro, the on-device voice, off the page's thread. The model is
 * downloaded from Hugging Face the first time and kept in the browser's
 * cache (`kokoro-files.ts`). The page decides when to download it
 * (`reading-voice.ts`); this worker loads it and reads.
 */

env.wasmPaths = { wasm: ortWasm };

const post = (reply: KokoroReply, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply, transfer);

let model: Promise<KokoroTTS> | undefined;
/** The request being read; a newer one or a stop ends it between sentences. */
let current = 0;

async function loadWith(chosen: VoiceSetup) {
  // Progress is reported only for a real download, not for reading the cache.
  const download = !(await voiceDownloaded(chosen));
  let percent = -1;
  const tts = await KokoroTTS.from_pretrained(kokoroModel, {
    dtype: chosen.dtype,
    device: chosen.device,
    progress_callback: (event) => {
      if (!download || event.status !== "progress" || !event.file.endsWith(".onnx")) return;
      const total = event.total || chosen.size;
      // One message per percent, not one per chunk.
      const now = Math.floor((event.loaded / total) * 100);
      if (now === percent) return;
      percent = now;
      post({ type: "progress", loaded: event.loaded, total, device: chosen.device });
    },
  });
  return { tts, device: chosen.device };
}

async function loadModel() {
  const chosen = await voiceSetup();
  if (chosen.device === "wasm") return loadWith(chosen);
  try {
    return await loadWith(chosen);
  } catch (error) {
    console.warn("The voice could not run on WebGPU; using the processor.", error);
    return loadWith(cpuSetup);
  }
}

function load() {
  model ??= loadModel().then(
    ({ tts, device }) => {
      post({ type: "loaded", device });
      return tts;
    },
    (error: unknown) => {
      model = undefined;
      post({ type: "failed", message: error instanceof Error ? error.message : String(error) });
      throw error;
    },
  );
  return model;
}

async function speak(id: number, text: string, speed: number) {
  current = id;
  try {
    const tts = await load();
    if (current !== id) return;
    // Given a string, kokoro-js 1.2 never closes its sentence stream and waits
    // forever after the last sentence, so the text goes in closed.
    const sentences = new TextSplitterStream();
    sentences.push(text);
    sentences.close();
    for await (const { audio } of tts.stream(sentences, { voice: kokoroVoice, speed })) {
      if (current !== id) return;
      const samples = audio.audio;
      post({ type: "audio", id, samples, sampleRate: audio.sampling_rate }, [samples.buffer]);
    }
    if (current === id) post({ type: "done", id });
  } catch (error) {
    if (current === id)
      post({ type: "error", id, message: error instanceof Error ? error.message : String(error) });
  }
}

self.addEventListener("message", (event: MessageEvent<KokoroRequest>) => {
  const request = event.data;
  if (request.type === "speak") void speak(request.id, request.text, request.speed);
  else if (request.type === "stop") current = 0;
  else if (request.type === "load") void load().catch(() => {});
});
