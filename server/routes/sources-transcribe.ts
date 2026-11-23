import { transcribe } from "ai";
import { z } from "zod";
import { describeError } from "@/lib/ai/errors";
import { createTranscriptionModel } from "@/lib/ai/providers";
import { credentialsSchema } from "@/lib/ai/request";
import {
  recordingMediaType,
  recordingProblem,
  transcriptionLimits,
  transcriptionProviderIds,
  type TranscriptionEvent,
} from "@/lib/sources/transcription";
import { timedParagraphs } from "@/lib/sources/transcript";

const providerSchema = z.enum(transcriptionProviderIds);
const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024));
// A line every so often keeps proxies from closing a long transcription.
const keepAliveMs = 15_000;

const fail = (error: string, status: number) => Response.json({ error }, { status });

/**
 * Transcribes an uploaded recording with the user's OpenAI or ElevenLabs key.
 * Multipart fields: `file`, `provider` and `credentials` (JSON). The upload is
 * held in memory for the one request and never written to disk.
 *
 * The answer is newline-delimited JSON: `{ status: "transcribing" }` once the
 * upload has arrived (and again while waiting), then the transcript
 * (`{ done, text, paragraphs }`) or `{ error }`.
 */
export async function POST(request: Request) {
  if (!(request.headers.get("content-type") ?? "").startsWith("multipart/form-data"))
    return fail("Send the recording as a file upload.", 415);
  const largest = Math.max(...transcriptionProviderIds.map((id) => transcriptionLimits[id].maxBytes));
  const length = Number(request.headers.get("content-length"));
  if (length > largest + 1024 * 1024)
    return fail(`The recording is larger than ${megabytes(largest)} MB.`, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("The upload could not be read. Try again.", 400);
  }
  const provider = providerSchema.safeParse(form.get("provider"));
  if (!provider.success) return fail("Choose OpenAI or ElevenLabs to transcribe.", 400);
  let rawCredentials: unknown;
  try {
    rawCredentials = JSON.parse(String(form.get("credentials") ?? "{}"));
  } catch {
    rawCredentials = undefined;
  }
  const credentials = credentialsSchema.safeParse(rawCredentials);
  const name = provider.data === "openai" ? "OpenAI" : "ElevenLabs";
  if (!credentials.success || !credentials.data.apiKey?.trim())
    return fail(`Add an API key for ${name} in Settings.`, 400);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("No recording was sent.", 400);
  const problem = recordingProblem(provider.data, file);
  if (problem === "type") return fail(`${name} cannot transcribe this kind of file.`, 415);
  if (problem === "tooLarge")
    return fail(
      `${name} transcribes files up to ${megabytes(transcriptionLimits[provider.data].maxBytes)} MB.`,
      413,
    );

  const audio = new Uint8Array(await file.arrayBuffer());
  const model = createTranscriptionModel(
    provider.data,
    { apiKey: credentials.data.apiKey.trim() },
    recordingMediaType(file.name, file.type),
  );
  const encoder = new TextEncoder();
  // Stops the provider call when the page cancels or goes away.
  const stop = new AbortController();
  const signal = AbortSignal.any([request.signal, stop.signal]);
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: TranscriptionEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The page went away.
        }
      };
      send({ status: "transcribing" });
      const timer = setInterval(() => send({ status: "transcribing" }), keepAliveMs);
      try {
        const result = await transcribe({
          model,
          audio,
          abortSignal: signal,
          // ElevenLabs would add "(laughter)" and the like between the words.
          providerOptions: { elevenlabs: { tagAudioEvents: false } },
        });
        const paragraphs = timedParagraphs(
          result.segments.map(({ text, startSecond, endSecond }) => ({
            text,
            start: startSecond,
            end: endSecond,
          })),
        );
        send({
          done: true,
          text: result.text.trim(),
          paragraphs,
          durationInSeconds: result.durationInSeconds,
        });
      } catch (error) {
        if (!signal.aborted) send({ error: describeError(error) });
      } finally {
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
    cancel() {
      stop.abort();
    },
  });
  return new Response(body, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
