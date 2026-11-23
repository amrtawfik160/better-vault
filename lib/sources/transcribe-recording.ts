import type { ProviderCredentials } from "@/lib/ai/catalog";
import type { AppSettings } from "@/lib/db/settings";
import { paragraphsText } from "./transcript";
import {
  transcriptionProviderIds,
  type TranscriptionEvent,
  type TranscriptionProviderId,
} from "./transcription";

/**
 * The providers that can transcribe with the user's settings: on, with an API
 * key (a ChatGPT sign-in pays for text only, not for transcription).
 */
export function transcriptionCredentials(
  settings: AppSettings,
): Partial<Record<TranscriptionProviderId, ProviderCredentials>> {
  const ready: Partial<Record<TranscriptionProviderId, ProviderCredentials>> = {};
  for (const id of transcriptionProviderIds) {
    const saved = settings.providers[id];
    if (saved.enabled && saved.apiKey.trim()) ready[id] = { apiKey: saved.apiKey.trim() };
  }
  return ready;
}

export type TranscriptionPhase = "uploading" | "transcribing";

/** Why a transcription failed: the provider's or server's words, no speech, or a cut-off answer. */
export class TranscriptionError extends Error {
  constructor(
    readonly reason: "failed" | "empty" | "stopped",
    readonly detail = "",
  ) {
    super(detail || reason);
    this.name = "TranscriptionError";
  }
}

/**
 * Sends a recording to `/api/sources/transcribe` and returns the transcript
 * as `[mm:ss]` paragraphs (plain text when the provider gave no timing).
 */
export async function transcribeRecording({
  file,
  provider,
  credentials,
  signal,
  onPhase,
}: {
  file: File;
  provider: TranscriptionProviderId;
  credentials: ProviderCredentials;
  signal?: AbortSignal;
  onPhase?: (phase: TranscriptionPhase) => void;
}): Promise<string> {
  const form = new FormData();
  form.append("provider", provider);
  form.append("credentials", JSON.stringify(credentials));
  form.append("file", file);
  onPhase?.("uploading");
  const response = await fetch("/api/sources/transcribe", { method: "POST", body: form, signal });
  if (!response.ok || !response.body) {
    const json = (await response.json().catch(() => ({}))) as { error?: string };
    throw new TranscriptionError(
      "failed",
      json.error ?? (response.statusText || `HTTP ${response.status}`),
    );
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) buffered += value;
      const lines = buffered.split("\n");
      buffered = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as TranscriptionEvent;
        if ("error" in event) throw new TranscriptionError("failed", event.error);
        if ("status" in event) onPhase?.("transcribing");
        else if (event.done) {
          const text = event.paragraphs.length ? paragraphsText(event.paragraphs) : event.text;
          if (!text.trim()) throw new TranscriptionError("empty");
          return text;
        }
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  throw new TranscriptionError("stopped");
}
