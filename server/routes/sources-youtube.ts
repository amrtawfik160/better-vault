import { generateText } from "ai";
import { z } from "zod";
import { describeError } from "@/lib/ai/errors";
import { createLanguageModel } from "@/lib/ai/providers";
import { credentialsSchema } from "@/lib/ai/request";
import { normalizeTimedTranscript } from "@/lib/sources/transcript";
import { youTubeId, youTubeWatchUrl } from "@/lib/sources/youtube";

/** Gemini's own name for a model that reads video well and costs little. */
export const GEMINI_TRANSCRIBE_MODEL = "gemini-flash-latest";

const bodySchema = z.object({
  url: z.url(),
  credentials: credentialsSchema,
});

// A line every so often keeps proxies from closing a long transcription.
const keepAliveMs = 15_000;

const PROMPT = [
  "Transcribe everything that is said in this video, word for word, in the language it is spoken in.",
  "Start a new paragraph about every minute, at the end of a sentence, and begin each paragraph with the time it starts, written as [mm:ss] (or [h:mm:ss] past the first hour).",
  "Leave out sounds and music. Write only the transcript: no title, no summary, no notes.",
].join(" ");

const fail = (error: string, status: number) => Response.json({ error }, { status });

/**
 * Transcribes a YouTube video that has no captions with Gemini, using the
 * user's Google key. JSON body: `{ url, credentials }`. Gemini watches the
 * video itself; nothing is downloaded here.
 *
 * The answer is newline-delimited JSON: `{ status: "transcribing" }` now and
 * then, then `{ done: true, text }` or `{ error }`.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Send the video's address and your Google key.", 400);
  const id = youTubeId(parsed.data.url);
  if (!id) return fail("That isn't a YouTube video address.", 400);
  const apiKey = parsed.data.credentials.apiKey?.trim();
  if (!apiKey) return fail("Add an API key for Google Gemini in Settings.", 400);

  const model = await createLanguageModel(
    { provider: "google", modelId: GEMINI_TRANSCRIBE_MODEL },
    { apiKey },
  );
  const encoder = new TextEncoder();
  const stop = new AbortController();
  const signal = AbortSignal.any([request.signal, stop.signal]);
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The page went away.
        }
      };
      send({ status: "transcribing" });
      const timer = setInterval(() => send({ status: "transcribing" }), keepAliveMs);
      try {
        const result = await generateText({
          model,
          abortSignal: signal,
          maxOutputTokens: 60_000,
          providerOptions: { google: { mediaResolution: "MEDIA_RESOLUTION_LOW" } },
          messages: [
            {
              role: "user",
              content: [
                { type: "file", data: youTubeWatchUrl(id), mediaType: "video/mp4" },
                { type: "text", text: PROMPT },
              ],
            },
          ],
        });
        const text = normalizeTimedTranscript(result.text);
        if (!text) send({ error: "Gemini heard no speech in this video." });
        else send({ done: true, text, cut: result.finishReason === "length" });
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
