import { encodeVoiceWav, maxVoiceSeconds, voiceSampleRate } from "./voice-format";
import { studyVoiceActivity } from "./voice-activity";

export class NoStudySpeech extends Error {}

export async function openStudyMicrophone(signal: AbortSignal) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new Error("This browser cannot record audio. You can still type a message.");
  }

  signal.throwIfAborted();
  const pending = navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true },
  });
  const stream = await new Promise<MediaStream>((resolve, reject) => {
    const cancelled = () => reject(signal.reason);
    signal.addEventListener("abort", cancelled, { once: true });
    void pending
      .then((stream) => {
        if (signal.aborted) stream.getTracks().forEach((track) => track.stop());
        else resolve(stream);
      }, reject)
      .finally(() => signal.removeEventListener("abort", cancelled));
  });
  const release = () => stream.getTracks().forEach((track) => track.stop());
  if (signal.aborted) {
    release();
    signal.throwIfAborted();
  }
  signal.addEventListener("abort", release, { once: true });
  return {
    stream,
    release: () => {
      signal.removeEventListener("abort", release);
      release();
    },
  };
}

export function recordStudyTurn(
  stream: MediaStream,
  signal: AbortSignal,
  listen?: { analyser: AnalyserNode; muted: () => boolean; onSpeech: () => void },
) {
  signal.throwIfAborted();
  const recorder = new MediaRecorder(stream);
  const startedAt = performance.now();
  const parts: Blob[] = [];
  const stop = () => {
    if (recorder.state !== "inactive") recorder.stop();
  };
  let speechAt: number | undefined;
  let meter: number | undefined;
  let manualEnd = false;
  const result = new Promise<{ audio: Blob; seconds: number; trimStart: number } | undefined>(
    (resolve, reject) => {
      recorder.ondataavailable = ({ data }) => {
        if (data.size) parts.push(data);
      };
      recorder.onerror = () => reject(new Error("The microphone stopped unexpectedly."));
      recorder.onstop = () => {
        if (listen && !manualEnd && (speechAt === undefined || listen.muted()))
          return resolve(undefined);
        const trimStart = Math.max(0, ((speechAt ?? startedAt) - startedAt) / 1_000 - 0.45);
        resolve({
          audio: new Blob(parts, { type: recorder.mimeType }),
          seconds: Math.min(maxVoiceSeconds, (performance.now() - startedAt) / 1_000 - trimStart),
          trimStart,
        });
      };
      recorder.start();
    },
  );
  const timer = window.setTimeout(stop, maxVoiceSeconds * 1_000);
  const track = stream.getAudioTracks()[0];
  track?.addEventListener("ended", stop, { once: true });
  signal.addEventListener("abort", stop, { once: true });
  if (listen) {
    const buffer = new Float32Array(listen.analyser.fftSize);
    const activity = studyVoiceActivity();
    meter = window.setInterval(() => {
      const now = performance.now();
      if (speechAt === undefined && now - startedAt >= 45_000) return stop();
      listen.analyser.getFloatTimeDomainData(buffer);
      let energy = 0;
      for (const sample of buffer) energy += sample * sample;
      const event = activity(Math.sqrt(energy / buffer.length), now, listen.muted());
      if (event === "speech") {
        speechAt = now;
        listen.onSpeech();
      } else if (event === "pause") stop();
    }, 40);
  }
  return {
    result: result.finally(() => {
      window.clearTimeout(timer);
      window.clearInterval(meter);
      track?.removeEventListener("ended", stop);
      signal.removeEventListener("abort", stop);
    }),
    stop: () => {
      manualEnd = true;
      stop();
    },
  };
}

export async function recordStudyVoice(signal: AbortSignal) {
  const microphone = await openStudyMicrophone(signal);
  try {
    const recording = recordStudyTurn(microphone.stream, signal);
    return {
      stop: recording.stop,
      result: recording.result.finally(microphone.release),
      mute: (muted: boolean) =>
        microphone.stream.getAudioTracks().forEach((track) => (track.enabled = !muted)),
    };
  } catch (error) {
    microphone.release();
    throw error;
  }
}

async function voiceWav(audio: Blob, trimStart: number) {
  if (!audio.size) throw new NoStudySpeech("The microphone did not capture any audio.");
  const decoder = new OfflineAudioContext(1, 1, voiceSampleRate);
  const decoded = await decoder.decodeAudioData(await audio.arrayBuffer()).catch(() => {
    throw new Error("Could not read the recording. Check your microphone and try again.");
  });
  const offset = Math.min(trimStart, decoded.duration / 2);
  const length = Math.min(
    decoded.length - Math.floor(offset * voiceSampleRate),
    maxVoiceSeconds * voiceSampleRate,
  );
  const mix = new OfflineAudioContext(1, length, voiceSampleRate);
  const player = mix.createBufferSource();
  player.buffer = decoded;
  player.connect(mix.destination);
  player.start(0, offset);
  const samples = (await mix.startRendering()).getChannelData(0);
  if (!samples.some((sample) => Math.abs(sample) >= 0.005)) {
    throw new NoStudySpeech("No speech was detected. Check the microphone and try again.");
  }
  return encodeVoiceWav(samples);
}

export async function transcribeStudyVoice(
  audio: Blob,
  language: string,
  signal: AbortSignal,
  trimStart = 0,
) {
  signal.throwIfAborted();
  const wav = await voiceWav(audio, trimStart);
  signal.throwIfAborted();
  const response = await fetch("/api/study/voice", {
    method: "POST",
    headers: {
      "content-type": "audio/wav",
      "x-study-language": language.trim().toLowerCase().split(/[-_]/)[0] || "auto",
    },
    body: wav,
    signal,
  });
  const result = await response.json();
  if (!response.ok || typeof result.text !== "string") {
    throw new Error(result.error ?? "Could not transcribe the recording.");
  }
  if (!result.text.trim()) throw new NoStudySpeech("No speech was detected. Try another recording.");
  return result.text.trim();
}
