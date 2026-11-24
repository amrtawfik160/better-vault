/// <reference lib="webworker" />
import { env, KokoroTTS, TextSplitterStream } from "kokoro-js";
// The ONNX runtime's WebAssembly, served with the app instead of from a CDN.
import ortWasm from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url";
import type { KokoroReply, KokoroRequest } from "./kokoro-protocol";
import { kokoroModel, kokoroVoice } from "./kokoro-protocol";

/**
 * Runs Kokoro, the on-device voice, off the page's thread. The model is
 * downloaded from Hugging Face the first time and kept in the browser's cache.
 *
 * With WebGPU it runs at full precision on the graphics chip, about three
 * times faster than speech (a 326 MB download). Without it, the 8-bit model
 * (92 MB) runs on the processor, slower than speech but fine for a word or
 * a sentence. 8-bit on WebGPU is as slow as the processor, so it isn't used.
 */

env.wasmPaths = { wasm: ortWasm };

/** How the model runs, and its file's size, for progress when the download doesn't say. */
type Setup = { device: "webgpu" | "wasm"; dtype: "fp32" | "q8"; file: string; size: number };
const gpuSetup: Setup = { device: "webgpu", dtype: "fp32", file: "model.onnx", size: 325_532_232 };
const cpuSetup: Setup = {
  device: "wasm",
  dtype: "q8",
  file: "model_quantized.onnx",
  size: 92_361_116,
};

const post = (reply: KokoroReply, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply, transfer);

let model: Promise<KokoroTTS> | undefined;
let loaded = false;
/** The request being read; a newer one or a stop ends it between sentences. */
let current = 0;

async function setup(): Promise<Setup> {
  try {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (gpu && (await gpu.requestAdapter())) return gpuSetup;
  } catch {
    // No WebGPU here.
  }
  return cpuSetup;
}

/** Whether a model file is already in the cache Transformers.js keeps. */
async function cached({ file }: Setup) {
  try {
    const cache = await caches.open("transformers-cache");
    const url = `https://huggingface.co/${kokoroModel}/resolve/main/onnx/${file}`;
    return (await cache.match(url)) !== undefined;
  } catch {
    return false;
  }
}

async function loadWith(chosen: Setup) {
  // Progress is reported only for a real download, not for reading the cache.
  const download = !(await cached(chosen));
  let percent = -1;
  return KokoroTTS.from_pretrained(kokoroModel, {
    dtype: chosen.dtype,
    device: chosen.device,
    progress_callback: (event) => {
      if (!download || event.status !== "progress" || !event.file.endsWith(".onnx")) return;
      const total = event.total || chosen.size;
      // One message per percent, not one per chunk.
      const now = Math.floor((event.loaded / total) * 100);
      if (now === percent) return;
      percent = now;
      post({ type: "progress", loaded: event.loaded, total });
    },
  });
}

async function loadModel() {
  const chosen = await setup();
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
    (tts) => {
      loaded = true;
      post({ type: "loaded" });
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
    // While the model downloads, the system's voice reads instead.
    if (!loaded && !model && !(await cached(await setup()))) {
      void load().catch(() => {});
      post({ type: "downloading", id });
      return;
    }
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
  else if (request.type === "prepare") void load().catch(() => {});
});
