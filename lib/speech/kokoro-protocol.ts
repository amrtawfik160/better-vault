/** Messages between the page and the Kokoro worker (`kokoro-worker.ts`). */

/** Kokoro 82M, as ONNX, from Hugging Face (Apache-2.0). */
export const kokoroModel = "onnx-community/Kokoro-82M-v1.0-ONNX";
/** Its best-rated voice: American English, "Heart". */
export const kokoroVoice = "af_heart";

export type KokoroRequest =
  | { type: "speak"; id: number; text: string; speed: number }
  | { type: "stop" }
  | { type: "prepare" };

export type KokoroReply =
  /** The model is downloading, the first time. */
  | { type: "progress"; loaded: number; total: number }
  /** The model is loaded. */
  | { type: "loaded" }
  /** The model could not be loaded. */
  | { type: "failed"; message: string }
  /** The model isn't downloaded yet; it is downloading now, and another voice reads this. */
  | { type: "downloading"; id: number }
  /** One sentence of speech, as mono samples. */
  | { type: "audio"; id: number; samples: Float32Array; sampleRate: number }
  | { type: "done"; id: number }
  | { type: "error"; id: number; message: string };
