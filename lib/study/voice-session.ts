import { NoStudySpeech, openStudyMicrophone, recordStudyTurn, transcribeStudyVoice } from "./voice";

export type StudyVoicePhase =
  "opening" | "listening" | "recording" | "transcribing" | "thinking" | "speaking";

const monitorOptions = { latencyHint: "interactive", sinkId: { type: "none" } } as const;

export function speakStudyReply(
  text: string,
  language: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const synthesis = window.speechSynthesis;
  if (signal?.aborted) return Promise.resolve(true);
  if (!synthesis) return Promise.resolve(false);
  const locale = (language || navigator.language).toLowerCase().replaceAll("_", "-");
  const voices = synthesis.getVoices().filter(({ localService }) => localService);
  const best =
    voices.find(({ lang }) => lang.toLowerCase() === locale) ??
    voices.find(({ lang }) => lang.toLowerCase().split("-")[0] === locale.split("-")[0]);
  if (!best) return Promise.resolve(false);

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = best.lang;
  utterance.voice = best;
  synthesis.cancel();
  return new Promise((resolve) => {
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

export function startStudyVoiceSession({
  language,
  signal,
  ready,
  phase,
  respond,
  speechUnavailable,
  noSpeech,
}: {
  language: string;
  signal: AbortSignal;
  ready: (signal: AbortSignal) => Promise<void>;
  phase: (phase: StudyVoicePhase) => void;
  respond: (transcript: string, seconds: number) => Promise<string>;
  speechUnavailable: () => void;
  noSpeech: () => void;
}) {
  const closeQuietly = new AbortController();
  const active = AbortSignal.any([signal, closeQuietly.signal]);
  let microphone: Awaited<ReturnType<typeof openStudyMicrophone>> | undefined;
  let current: StudyVoicePhase = "opening";
  let ending = false;
  let listening = false;
  let muted = false;
  let finishTurn: (() => void) | undefined;
  let playback: AbortController | undefined;
  let warned = false;

  const updateTrack = () =>
    microphone?.stream.getAudioTracks().forEach((track) => {
      track.enabled = listening && !muted && !ending;
    });

  function changePhase(next: StudyVoicePhase) {
    current = next;
    phase(next);
  }

  function releaseMicrophone() {
    microphone?.release();
    microphone = undefined;
  }

  async function run() {
    active.throwIfAborted();
    const context = new AudioContext(monitorOptions);
    const closeAudio = () => {
      if (context.state !== "closed") void context.close().catch(() => undefined);
    };
    active.addEventListener("abort", closeAudio, { once: true });
    try {
      await context.resume();
      await ready(active);
      microphone = await openStudyMicrophone(active);
      const { stream } = microphone;
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState === "ended") throw new DOMException("", "NotReadableError");
      const meter = context.createAnalyser();
      meter.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(meter);

      while (!active.aborted && !ending) {
        listening = true;
        updateTrack();
        changePhase("listening");
        const recording = recordStudyTurn(stream, active, {
          analyser: meter,
          muted: () => muted,
          onSpeech: () => changePhase("recording"),
        });
        finishTurn = recording.stop;
        const turn = await recording.result;
        finishTurn = undefined;
        listening = false;
        updateTrack();
        active.throwIfAborted();
        if (track.readyState !== "live") throw new DOMException("", "NotReadableError");
        if (!turn) return "idle";
        if (ending) releaseMicrophone();

        changePhase("transcribing");
        let transcript: string;
        try {
          transcript = await transcribeStudyVoice(turn.audio, language, active, turn.trimStart);
        } catch (error) {
          active.throwIfAborted();
          if (!(error instanceof NoStudySpeech)) throw error;
          if (!ending) noSpeech();
          continue;
        }
        active.throwIfAborted();
        changePhase("thinking");
        const reply = await respond(transcript, turn.seconds);
        active.throwIfAborted();
        if (ending) break;
        changePhase("speaking");
        playback = new AbortController();
        const spoken = await speakStudyReply(
          reply,
          language,
          AbortSignal.any([active, playback.signal]),
        );
        playback = undefined;
        if (!spoken && !warned) {
          warned = true;
          speechUnavailable();
        }
      }
    } catch (error) {
      if (!closeQuietly.signal.aborted || signal.aborted) throw error;
    } finally {
      active.removeEventListener("abort", closeAudio);
      releaseMicrophone();
      closeAudio();
    }
  }

  const result = run();
  return {
    result,
    mute: (next: boolean) => {
      muted = next;
      updateTrack();
    },
    finishTurn: () => finishTurn?.(),
    interrupt: () => playback?.abort(),
    finishForReport: () => {
      ending = true;
      if (current === "opening" || current === "listening") closeQuietly.abort();
      else if (current === "recording") finishTurn?.();
      else releaseMicrophone();
      playback?.abort();
      updateTrack();
      return result;
    },
  };
}
