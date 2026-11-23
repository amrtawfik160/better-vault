import { MockTranscriptionModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptionEvent } from "@/lib/sources/transcription";

const calls: { provider: string; apiKey?: string; mediaType?: string }[] = [];

vi.mock("@/lib/ai/providers", () => ({
  createTranscriptionModel: (
    provider: string,
    credentials: { apiKey?: string },
    mediaType?: string,
  ) => {
    calls.push({ provider, apiKey: credentials.apiKey, mediaType });
    return new MockTranscriptionModelV4({
      doGenerate: async () => ({
        text: "Hello there. Second part.",
        segments: [
          { text: "Hello there.", startSecond: 0, endSecond: 2 },
          { text: "Second part.", startSecond: 30, endSecond: 32 },
        ],
        language: "en",
        durationInSeconds: 32,
        warnings: [],
        response: { timestamp: new Date(), modelId: "mock" },
      }),
    });
  },
}));

const { POST } = await import("./sources-transcribe");

function upload(fields: Record<string, string | File>) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return POST(new Request("http://localhost/api/sources/transcribe", { method: "POST", body: form }));
}

const key = JSON.stringify({ apiKey: "test-key" });
const recording = (name = "talk.mp3", bytes = 16) =>
  new File([new Uint8Array(bytes)], name, { type: "" });

async function events(response: Response) {
  return (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TranscriptionEvent);
}

beforeEach(() => {
  calls.length = 0;
});

describe("POST /api/sources/transcribe", () => {
  it("transcribes the upload and sends timed paragraphs", async () => {
    const response = await upload({ provider: "elevenlabs", credentials: key, file: recording() });
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(await events(response)).toEqual([
      { status: "transcribing" },
      {
        done: true,
        text: "Hello there. Second part.",
        paragraphs: [{ start: 0, text: "Hello there. Second part." }],
        durationInSeconds: 32,
      },
    ]);
    expect(calls).toEqual([{ provider: "elevenlabs", apiKey: "test-key", mediaType: "audio/mpeg" }]);
  });

  it("asks for a key without calling the provider", async () => {
    const response = await upload({ provider: "openai", credentials: "{}", file: recording() });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Add an API key for OpenAI in Settings." });
    expect(calls).toEqual([]);
  });

  it("refuses files the provider cannot take", async () => {
    const mov = await upload({ provider: "openai", credentials: key, file: recording("clip.mov") });
    expect(mov.status).toBe(415);
    const large = await upload({
      provider: "openai",
      credentials: key,
      file: recording("talk.mp3", 25 * 1024 * 1024 + 1),
    });
    expect(large.status).toBe(413);
    expect(await large.json()).toEqual({ error: "OpenAI transcribes files up to 25 MB." });
    expect(calls).toEqual([]);
  });

  it("never echoes the key in an error", async () => {
    const response = await upload({
      provider: "nope",
      credentials: JSON.stringify({ apiKey: "sk-secret-value-123456" }),
      file: recording(),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("sk-secret");
  });
});
