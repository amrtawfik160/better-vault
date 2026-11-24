import { speechLanguage } from "@/lib/study/translation-language";
import type { KokoroReply, KokoroRequest } from "./kokoro-protocol";
import { spokenText } from "./spoken-text";
import { systemVoice } from "./system-voice";

/**
 * Reads text aloud. English is read by Kokoro, a neural voice that runs on
 * the device (`kokoro-worker.ts`); other languages, and English when Kokoro
 * can't run, by the system's best voice for the language.
 */

/** The voice's first download: how far it got, then whether the voice is ready. */
export type VoiceDownload = { loaded: number; total: number } | "ready" | "failed";

const downloadListeners = new Set<(download: VoiceDownload) => void>();

export function subscribeVoiceDownload(listener: (download: VoiceDownload) => void) {
  downloadListeners.add(listener);
  return () => void downloadListeners.delete(listener);
}

function announce(download: VoiceDownload) {
  for (const listener of downloadListeners) listener(download);
}

type Reading = { id: number; handle: (reply: KokoroReply) => void; stop: () => void };

let worker: Worker | undefined;
let audio: AudioContext | undefined;
let reading: Reading | undefined;
let lastId = 0;

function canRunKokoro() {
  return (
    typeof window !== "undefined" &&
    typeof Worker === "function" &&
    typeof WebAssembly === "object" &&
    typeof AudioContext === "function"
  );
}

function kokoro() {
  if (!worker) {
    worker = new Worker(new URL("./kokoro-worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<KokoroReply>) => {
      const reply = event.data;
      if (reply.type === "progress") return announce({ loaded: reply.loaded, total: reply.total });
      if (reply.type === "loaded") return announce("ready");
      if (reply.type === "failed") {
        console.warn("The on-device voice could not load:", reply.message);
        return announce("failed");
      }
      if (reading?.id === reply.id) reading.handle(reply);
    });
    worker.addEventListener("error", () => {
      announce("failed");
      reading?.handle({ type: "error", id: reading.id, message: "The voice stopped." });
      worker?.terminate();
      worker = undefined;
    });
  }
  return worker;
}

function send(request: KokoroRequest) {
  kokoro().postMessage(request);
}

/** Stops whatever is being read aloud. */
export function stopSpeaking() {
  reading?.stop();
  reading = undefined;
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

/** Starts the voice's download ahead of the first Listen, as a voice conversation begins. */
export function prepareSpeech() {
  if (canRunKokoro()) send({ type: "prepare" });
}

/**
 * Reads English with Kokoro: "spoken", or "failed" before a sound was made,
 * as while the model downloads the first time.
 */
function speakWithKokoro(text: string, signal?: AbortSignal): Promise<"spoken" | "failed"> {
  const id = ++lastId;
  const context = (audio ??= new AudioContext());
  void context.resume();

  return new Promise((resolve) => {
    const sources = new Set<AudioBufferSourceNode>();
    let startAt = 0;
    let generated = false;
    let played = false;
    let settled = false;

    const finish = (result: "spoken" | "failed") => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", stop);
      if (reading?.id === id) reading = undefined;
      resolve(result);
    };
    function stop() {
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // It had not started.
        }
      }
      sources.clear();
      send({ type: "stop" });
      finish("spoken");
    }

    reading = {
      id,
      stop,
      handle(reply) {
        if (reply.type === "audio") {
          played = true;
          const buffer = context.createBuffer(1, reply.samples.length, reply.sampleRate);
          buffer.copyToChannel(reply.samples as Float32Array<ArrayBuffer>, 0);
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(context.destination);
          const at = Math.max(context.currentTime + 0.02, startAt);
          source.start(at);
          startAt = at + buffer.duration;
          sources.add(source);
          source.addEventListener("ended", () => {
            sources.delete(source);
            if (generated && sources.size === 0) finish("spoken");
          });
        } else if (reply.type === "done") {
          generated = true;
          if (sources.size === 0) finish("spoken");
        } else if (reply.type === "downloading") {
          finish("failed");
        } else if (reply.type === "error") {
          console.warn("The on-device voice failed:", reply.message);
          finish(played ? "spoken" : "failed");
        }
      },
    };
    if (signal?.aborted) return stop();
    signal?.addEventListener("abort", stop, { once: true });
    send({ type: "speak", id, text, speed: 1 });
  });
}

/** Reads text with the system's best voice for its language. */
async function speakWithSystem(text: string, language: string, signal?: AbortSignal) {
  const synthesis = typeof window === "undefined" ? undefined : window.speechSynthesis;
  if (!synthesis || typeof window.SpeechSynthesisUtterance !== "function") return false;
  const voice = await systemVoice(synthesis, language || navigator.language);
  if (!voice) return false;
  if (signal?.aborted) return true;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voice.lang;
  utterance.voice = voice;
  synthesis.cancel();
  return new Promise<boolean>((resolve) => {
    const finish = (spoken: boolean) => {
      signal?.removeEventListener("abort", cancel);
      window.clearTimeout(timeout);
      utterance.onend = null;
      utterance.onerror = null;
      resolve(spoken);
    };
    const cancel = () => {
      finish(true);
      synthesis.cancel();
    };
    const timeout = window.setTimeout(() => {
      finish(false);
      synthesis.cancel();
    }, 180_000);
    signal?.addEventListener("abort", cancel, { once: true });
    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);
    try {
      synthesis.speak(utterance);
    } catch {
      finish(false);
    }
  });
}

/**
 * Reads text aloud and resolves when it ends or is stopped: false when no
 * voice could read it. `language` is the expected language (a BCP 47 tag);
 * without it, the text's script decides.
 */
export async function speak(
  text: string,
  { language, signal }: { language?: string; signal?: AbortSignal } = {},
): Promise<boolean> {
  const words = spokenText(text);
  if (!words) return false;
  stopSpeaking();
  const script = speechLanguage(words);
  const lang = (language || script).toLowerCase().replaceAll("_", "-");
  const english = script === "en" && lang.split("-")[0] === "en";
  if (english && canRunKokoro()) {
    const result = await speakWithKokoro(words, signal);
    if (result === "spoken") return true;
  }
  return speakWithSystem(words, lang, signal);
}

/** Whether this browser or app can read aloud at all. */
export function canSpeak() {
  return (
    canRunKokoro() ||
    (typeof window !== "undefined" && typeof window.SpeechSynthesisUtterance === "function")
  );
}
