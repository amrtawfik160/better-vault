/** Messages between the page and the Kokoro worker (`kokoro-worker.ts`). */

/** Kokoro 82M, as ONNX, from Hugging Face (Apache-2.0). */
export const kokoroModel = "onnx-community/Kokoro-82M-v1.0-ONNX";
/** Its best-rated voice: American English, "Heart". */
export const kokoroVoice = "af_heart";

export type KokoroRequest =
  | { type: "speak"; id: number; text: string; speed: number }
  | { type: "stop" }
  /** Loads the model, downloading it if it isn't yet. */
  | { type: "load" };

export type KokoroReply =
  /** The model is downloading. */
  | { type: "progress"; loaded: number; total: number; device: "webgpu" | "wasm" }
  /** The model is loaded, and runs on this device. */
  | { type: "loaded"; device: "webgpu" | "wasm" }
  /** The model could not be loaded. */
  | { type: "failed"; message: string }
  /** One sentence of speech, as mono samples. */
  | { type: "audio"; id: number; samples: Float32Array; sampleRate: number }
  | { type: "done"; id: number }
  | { type: "error"; id: number; message: string };
