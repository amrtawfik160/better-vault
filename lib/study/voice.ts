import { encodeVoiceWav, maxVoiceSeconds, voiceSampleRate } from "./voice-format";

export async function recordStudyVoice(signal: AbortSignal) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new Error("This browser cannot record audio. You can still type a message.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true },
  });
  const release = () => stream.getTracks().forEach((track) => track.stop());
  if (signal.aborted) {
    release();
    signal.throwIfAborted();
  }

  try {
    const recorder = new MediaRecorder(stream);
    const parts: Blob[] = [];
    const startedAt = performance.now();
    const stop = () => {
      if (recorder.state !== "inactive") recorder.stop();
    };
    const timer = window.setTimeout(stop, maxVoiceSeconds * 1000);
    const cancel = () => {
      stop();
      release();
    };
    signal.addEventListener("abort", cancel, { once: true });
    const result = new Promise<{ audio: Blob; seconds: number }>((resolve, reject) => {
      recorder.ondataavailable = ({ data }) => {
        if (data.size) parts.push(data);
      };
      recorder.onerror = () => reject(new Error("The microphone stopped unexpectedly."));
      recorder.onstop = () =>
        resolve({
          audio: new Blob(parts, { type: recorder.mimeType }),
          seconds: Math.min(maxVoiceSeconds, (performance.now() - startedAt) / 1000),
        });
      recorder.start();
    }).finally(() => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      release();
    });
    return {
      stop,
      result,
      mute: (muted: boolean) =>
        stream.getAudioTracks().forEach((track) => (track.enabled = !muted)),
    };
  } catch (error) {
    release();
    throw error;
  }
}

async function voiceWav(audio: Blob) {
  if (!audio.size) throw new Error("The microphone did not capture any audio.");
  const decoder = new OfflineAudioContext(1, 1, voiceSampleRate);
  const decoded = await decoder.decodeAudioData(await audio.arrayBuffer());
  const length = Math.min(decoded.length, maxVoiceSeconds * voiceSampleRate);
  const mix = new OfflineAudioContext(1, length, voiceSampleRate);
  const player = mix.createBufferSource();
  player.buffer = decoded;
  player.connect(mix.destination);
  player.start();
  const samples = (await mix.startRendering()).getChannelData(0);
  if (!samples.some((sample) => Math.abs(sample) >= 0.005)) {
    throw new Error("No speech was detected. Check the microphone and try again.");
  }
  return encodeVoiceWav(samples);
}

export async function transcribeStudyVoice(audio: Blob, language: string, signal: AbortSignal) {
  const wav = await voiceWav(audio);
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
  if (!result.text.trim()) throw new Error("No speech was detected. Try another recording.");
  return result.text.trim();
}
