import { openStudyMicrophone, recordStudyTurn, transcribeStudyVoice } from "./voice";

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
}: {
  language: string;
  signal: AbortSignal;
  ready: () => Promise<void>;
  phase: (phase: StudyVoicePhase) => void;
  respond: (transcript: string, seconds: number) => Promise<string>;
  speechUnavailable: () => void;
}) {
  let microphone: Awaited<ReturnType<typeof openStudyMicrophone>> | undefined;
  let listening = false;
  let muted = false;
  let finishTurn: (() => void) | undefined;
  let playback: AbortController | undefined;
  let warned = false;

  const updateTrack = () =>
    microphone?.stream.getAudioTracks().forEach((track) => {
      track.enabled = listening && !muted;
    });

  async function run() {
    signal.throwIfAborted();
    const context = new AudioContext(monitorOptions);
    const closeAudio = () => {
      if (context.state !== "closed") void context.close().catch(() => undefined);
    };
    signal.addEventListener("abort", closeAudio, { once: true });
    try {
      await context.resume();
      await ready();
      microphone = await openStudyMicrophone(signal);
      const { stream } = microphone;
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState === "ended") throw new DOMException("", "NotReadableError");
      const meter = context.createAnalyser();
      meter.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(meter);

      while (!signal.aborted) {
        listening = true;
        updateTrack();
        phase("listening");
        const recording = recordStudyTurn(stream, signal, {
          analyser: meter,
          muted: () => muted,
          onSpeech: () => phase("recording"),
        });
        finishTurn = recording.stop;
        const turn = await recording.result;
        finishTurn = undefined;
        listening = false;
        updateTrack();
        signal.throwIfAborted();
        if (track.readyState !== "live") throw new DOMException("", "NotReadableError");
        if (!turn) return "idle";

        phase("transcribing");
        const transcript = await transcribeStudyVoice(turn.audio, language, signal, turn.trimStart);
        signal.throwIfAborted();
        phase("thinking");
        const reply = await respond(transcript, turn.seconds);
        signal.throwIfAborted();
        phase("speaking");
        playback = new AbortController();
        const spoken = await speakStudyReply(
          reply,
          language,
          AbortSignal.any([signal, playback.signal]),
        );
        playback = undefined;
        if (!spoken && !warned) {
          warned = true;
          speechUnavailable();
        }
      }
    } finally {
      signal.removeEventListener("abort", closeAudio);
      microphone?.release();
      closeAudio();
    }
  }

  return {
    result: run(),
    mute: (next: boolean) => {
      muted = next;
      updateTrack();
    },
    finishTurn: () => finishTurn?.(),
    interrupt: () => playback?.abort(),
  };
}
