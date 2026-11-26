import { kokoroModel } from "./kokoro-protocol";

/**
 * Where the on-device voice's files are, and how it runs here. Shared by the
 * page (to show and manage the download) and the worker (to run the model).
 *
 * With WebGPU it runs at full precision on the graphics chip, about three
 * times faster than speech. Without it, the 8-bit model runs on the
 * processor: slower than speech, but fine for a word or a sentence. 8-bit on
 * WebGPU is as slow as the processor, so it isn't used.
 */

export type VoiceSetup = {
  device: "webgpu" | "wasm";
  dtype: "fp32" | "q8";
  file: string;
  /** The model file's size in bytes, from Hugging Face. */
  size: number;
};

export const gpuSetup: VoiceSetup = {
  device: "webgpu",
  dtype: "fp32",
  file: "model.onnx",
  size: 325_532_232,
};
export const cpuSetup: VoiceSetup = {
  device: "wasm",
  dtype: "q8",
  file: "model_quantized.onnx",
  size: 92_361_116,
};

/** The cache Transformers.js keeps model files in, and the one kokoro-js keeps voices in. */
const modelCache = "transformers-cache";
const voicesCache = "kokoro-voices";

let chosen: Promise<VoiceSetup> | undefined;

/** WebGPU when this device has a graphics adapter for it, else the processor. */
export function voiceSetup(): Promise<VoiceSetup> {
  chosen ??= (async () => {
    try {
      const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
      if (gpu && (await gpu.requestAdapter())) return gpuSetup;
    } catch {
      // No WebGPU here.
    }
    return cpuSetup;
  })();
  return chosen;
}

const fileUrl = (file: string) =>
  `https://huggingface.co/${kokoroModel}/resolve/main/onnx/${file}`;

/** Whether the model file is downloaded. */
export async function voiceDownloaded({ file }: VoiceSetup) {
  try {
    const cache = await caches.open(modelCache);
    return (await cache.match(fileUrl(file))) !== undefined;
  } catch {
    return false;
  }
}

/** Deletes the voice's downloaded files, both precisions, to free the space. */
export async function deleteVoiceFiles() {
  try {
    const cache = await caches.open(modelCache);
    const keys = await cache.keys();
    await Promise.all(
      keys.filter(({ url }) => url.includes(kokoroModel)).map((key) => cache.delete(key)),
    );
    await caches.delete(voicesCache);
  } catch {
    // No cache to clear.
  }
}
