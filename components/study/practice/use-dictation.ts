import { useEffect, useRef, useState } from "react";
import { recordStudyVoice, transcribeStudyVoice } from "@/lib/study/voice";

export type DictationState = "idle" | "opening" | "recording" | "transcribing";

/**
 * Dictation into a Practice answer, with the Study voice input: the
 * microphone records until the learner pauses or stops it, and the audio is
 * transcribed on this device. `available` stays false where local voice is
 * not set up, so the button is not offered.
 */
export function useDictation(onText: (text: string) => void, onError: (message: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const [available, setAvailable] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  const abort = useRef<AbortController | null>(null);
  const callbacks = useRef({ onText, onError });
  useEffect(() => {
    callbacks.current = { onText, onError };
  });

  useEffect(() => {
    const probe = new AbortController();
    fetch("/api/study/voice", { signal: probe.signal })
      .then((response) => response.json())
      .then((status: { available?: boolean }) => setAvailable(status.available === true))
      .catch(() => setAvailable(false));
    return () => {
      probe.abort();
      abort.current?.abort();
    };
  }, []);

  async function start() {
    if (abort.current) return;
    const controller = new AbortController();
    abort.current = controller;
    setState("opening");
    try {
      const recording = await recordStudyVoice(controller.signal);
      stop.current = recording.stop;
      setState("recording");
      const turn = await recording.result;
      if (!turn) return;
      setState("transcribing");
      callbacks.current.onText(await transcribeStudyVoice(turn.audio, "en", controller.signal));
    } catch (error) {
      if (!controller.signal.aborted) callbacks.current.onError(error instanceof Error ? error.message : String(error));
    } finally {
      abort.current = null;
      stop.current = null;
      setState("idle");
    }
  }

  return {
    available,
    state,
    toggle: () => (state === "recording" ? stop.current?.() : state === "idle" ? void start() : undefined),
  };
}
