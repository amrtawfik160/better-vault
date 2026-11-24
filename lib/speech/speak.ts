import { speechLanguage } from "@/lib/study/translation-language";
import type { KokoroReply } from "./kokoro-protocol";
import {
  canRunVoiceModel,
  checkReadingVoice,
  downloadReadingVoice,
  onVoiceReply,
  rememberWaitingText,
  sendToVoice,
  voiceDeclined,
} from "./reading-voice";
import { spokenText } from "./spoken-text";
import { systemVoice } from "./system-voice";

/**
 * Reads text aloud. English is read by Kokoro, a neural voice that runs on
 * the device (`reading-voice.ts`), once it is downloaded; other languages,
 * and English until then, by the system's best voice for the language.
 */

type Reading = { id: number; handle: (reply: KokoroReply) => void; stop: () => void };

let audio: AudioContext | undefined;
let reading: Reading | undefined;
let lastId = 0;
let listening = false;

/** Stops whatever is being read aloud. */
export function stopSpeaking() {
  reading?.stop();
  reading = undefined;
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

/** Loads the voice ahead of the first reply, as a voice conversation begins. */
export function prepareSpeech() {
  void checkReadingVoice().then((voice) => {
    if (voice.status === "installed") sendToVoice({ type: "load" });
    else if (voice.status === "missing" && !voiceDeclined()) void downloadReadingVoice();
  });
}

/** Reads English with Kokoro: "spoken", or "failed" before a sound was made. */
function speakWithKokoro(text: string, signal?: AbortSignal): Promise<"spoken" | "failed"> {
  const id = ++lastId;
  const context = (audio ??= new AudioContext());
  void context.resume();
  if (!listening) {
    listening = true;
    onVoiceReply((reply) => {
      if (reply.type === "failed") reading?.handle(reply);
      else if ("id" in reply && reading?.id === reply.id) reading.handle(reply);
    });
  }

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
      sendToVoice({ type: "stop" });
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
        } else if (reply.type === "error" || reply.type === "failed") {
          console.warn("The on-device voice failed:", reply.message);
          finish(played ? "spoken" : "failed");
        }
      },
    };
    if (signal?.aborted) return stop();
    signal?.addEventListener("abort", stop, { once: true });
    sendToVoice({ type: "speak", id, text, speed: 1 });
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
    // Stopped or replaced by newer speech: that is not a missing voice.
    utterance.onerror = (event) => finish(event.error === "interrupted" || event.error === "canceled");
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
  if (english && canRunVoiceModel()) {
    const voice = await checkReadingVoice();
    if (voice.status === "installed") {
      if ((await speakWithKokoro(words, signal)) === "spoken") return true;
    } else if (voice.status === "missing" || voice.status === "downloading") {
      // The system voice reads now; the natural one can read it again once ready.
      rememberWaitingText(words, lang);
      if (voice.status === "missing" && !voiceDeclined()) void downloadReadingVoice();
    }
  }
  return speakWithSystem(words, lang, signal);
}

/** Whether this browser or app can read aloud at all. */
export function canSpeak() {
  return (
    canRunVoiceModel() ||
    (typeof window !== "undefined" && typeof window.SpeechSynthesisUtterance === "function")
  );
}
