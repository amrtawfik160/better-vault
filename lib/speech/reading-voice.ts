import { useEffect, useSyncExternalStore } from "react";
import { deleteVoiceFiles, voiceDownloaded, voiceSetup } from "./kokoro-files";
import type { KokoroReply, KokoroRequest } from "./kokoro-protocol";

/**
 * The on-device reading voice: whether it is downloaded, its download's
 * progress, and the worker that runs it (`kokoro-worker.ts`). The first
 * English Listen starts the download; a cancelled download isn't started
 * again by itself, only from Settings → Reading voice.
 */

export type ReadingVoice = {
  status: "unknown" | "missing" | "downloading" | "installed" | "failed";
  /** Where it runs: the graphics chip, or the processor. */
  device?: "webgpu" | "wasm";
  /** The model's size in bytes, for this device. */
  size?: number;
  /** While downloading. */
  loaded: number;
  total: number;
  /** About how long the download has left, once it can tell. */
  secondsLeft?: number;
  error?: string;
};

type Listener = (next: ReadingVoice, previous: ReadingVoice) => void;

let state: ReadingVoice = { status: "unknown", loaded: 0, total: 0 };
let startedAt = 0;
const listeners = new Set<Listener>();

function set(next: Partial<ReadingVoice>) {
  const previous = state;
  state = { ...state, ...next };
  for (const listener of listeners) listener(state, previous);
}

export function getReadingVoice() {
  return state;
}

export function subscribeReadingVoice(listener: Listener) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const declinedKey = "better-vault:reading-voice-declined";

/** Whether the user cancelled a download, so Listen doesn't start it again. */
export function voiceDeclined() {
  try {
    return localStorage.getItem(declinedKey) === "1";
  } catch {
    return false;
  }
}

function setDeclined(declined: boolean) {
  try {
    if (declined) localStorage.setItem(declinedKey, "1");
    else localStorage.removeItem(declinedKey);
  } catch {
    // Storage is off; Listen will offer the download again.
  }
}

export function canRunVoiceModel() {
  return (
    typeof window !== "undefined" &&
    typeof Worker === "function" &&
    typeof WebAssembly === "object" &&
    typeof AudioContext === "function" &&
    typeof caches === "object"
  );
}

let checking: Promise<ReadingVoice> | undefined;

/** Finds out, once, whether the voice is downloaded and where it would run. */
export function checkReadingVoice(): Promise<ReadingVoice> {
  if (state.status !== "unknown") return Promise.resolve(state);
  if (!canRunVoiceModel()) {
    set({ status: "failed", error: "unsupported" });
    return Promise.resolve(state);
  }
  checking ??= (async () => {
    const setup = await voiceSetup();
    const downloaded = await voiceDownloaded(setup);
    // A download may have started meanwhile.
    if (state.status === "unknown")
      set({ status: downloaded ? "installed" : "missing", device: setup.device, size: setup.size });
    return state;
  })();
  return checking;
}

// --- The worker ---

let worker: Worker | undefined;
const replyListeners = new Set<(reply: KokoroReply) => void>();

function handle(reply: KokoroReply) {
  if (reply.type === "progress") {
    if (state.status !== "downloading") startedAt = Date.now();
    const seconds = (Date.now() - startedAt) / 1000;
    const rate = seconds > 2 ? reply.loaded / seconds : 0;
    set({
      status: "downloading",
      device: reply.device,
      loaded: reply.loaded,
      total: reply.total,
      size: reply.total,
      secondsLeft: rate > 0 ? Math.max(0, (reply.total - reply.loaded) / rate) : undefined,
      error: undefined,
    });
  } else if (reply.type === "loaded") {
    set({ status: "installed", device: reply.device, error: undefined });
  } else if (reply.type === "failed") {
    console.warn("The on-device voice could not load:", reply.message);
    set({ status: "failed", error: reply.message });
  }
  for (const listener of replyListeners) listener(reply);
}

function voiceWorker() {
  if (!worker) {
    worker = new Worker(new URL("./kokoro-worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<KokoroReply>) => handle(event.data));
    worker.addEventListener("error", () => {
      stopWorker();
      handle({ type: "failed", message: "The voice stopped." });
    });
  }
  return worker;
}

function stopWorker() {
  worker?.terminate();
  worker = undefined;
}

export function sendToVoice(request: KokoroRequest) {
  voiceWorker().postMessage(request);
}

/** Follows the worker's replies (for reading aloud). */
export function onVoiceReply(listener: (reply: KokoroReply) => void) {
  replyListeners.add(listener);
  return () => void replyListeners.delete(listener);
}

// --- What the user can do ---

/** Downloads the voice (or loads it, if it is downloaded). */
export async function downloadReadingVoice() {
  if (!canRunVoiceModel()) return;
  setDeclined(false);
  const current = await checkReadingVoice();
  if (current.status === "downloading") return;
  if (current.status !== "installed") {
    startedAt = Date.now();
    set({
      status: "downloading",
      loaded: 0,
      total: current.size ?? 0,
      secondsLeft: undefined,
      error: undefined,
    });
  }
  sendToVoice({ type: "load" });
}

/** Stops the download; Listen won't start it again until the user does. */
export function cancelVoiceDownload() {
  stopWorker();
  setDeclined(true);
  set({ status: "missing", loaded: 0, total: 0, secondsLeft: undefined });
}

/** Deletes the downloaded voice to free its space. */
export async function removeReadingVoice() {
  stopWorker();
  await deleteVoiceFiles();
  setDeclined(true);
  set({ status: "missing", loaded: 0, total: 0, secondsLeft: undefined, error: undefined });
}

/** The text Listen last read with the system voice while the voice downloaded, to hear again. */
let waiting: { text: string; language: string } | undefined;

export function rememberWaitingText(text: string, language: string) {
  waiting = { text, language };
}

export function takeWaitingText() {
  const text = waiting;
  waiting = undefined;
  return text;
}

/** The reading voice's state, checked on first use. */
export function useReadingVoice() {
  const voice = useSyncExternalStore(subscribeReadingVoice, getReadingVoice, getReadingVoice);
  useEffect(() => {
    void checkReadingVoice();
  }, []);
  return voice;
}
