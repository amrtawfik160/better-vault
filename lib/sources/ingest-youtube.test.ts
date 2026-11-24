import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addSource = vi.fn(async (input: Record<string, unknown>) => ({ id: "s1", ...input }));
vi.mock("@/lib/db/sources", () => ({ addSource, attachImages: vi.fn() }));

const { IngestError, ingestUrl, ingestYouTubeWithGemini } = await import("./ingest");

const video = {
  id: "MT4Ig2uqjTc",
  title: "How to Talk to Users",
  author: "Y Combinator",
  seconds: 1897,
  url: "https://www.youtube.com/watch?v=MT4Ig2uqjTc",
};

const answer = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

beforeEach(() => addSource.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe("ingestUrl with a YouTube video", () => {
  it("saves the captions the server read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        answer({ title: video.title, text: "[00:00] Hi.", kind: "text", url: video.url }),
      ),
    );
    await ingestUrl("nb", "https://youtu.be/MT4Ig2uqjTc");
    expect(addSource).toHaveBeenCalledWith(
      expect.objectContaining({ notebookId: "nb", title: video.title, url: video.url }),
    );
  });

  it("fails with noCaptions and the video when there are none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer({ error: "No captions", code: "noCaptions", video }, 422)),
    );
    const failure = await ingestUrl("nb", video.url).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(IngestError);
    expect(failure).toMatchObject({ reason: "noCaptions", video });
    expect(addSource).not.toHaveBeenCalled();
  });
});

describe("ingestYouTubeWithGemini", () => {
  it("saves the transcript from the streamed answer, with the link first", async () => {
    const stream = [
      JSON.stringify({ status: "transcribing" }),
      JSON.stringify({ status: "transcribing" }),
      JSON.stringify({ done: true, text: "[00:00] Talk about their life." }),
    ].join("\n");
    const fetch = vi.fn(async (_address: string, _init: RequestInit) => answer(`${stream}\n`));
    vi.stubGlobal("fetch", fetch);
    await ingestYouTubeWithGemini("nb", video, { apiKey: "test" });
    const [address, init] = fetch.mock.calls[0];
    expect(address).toBe("/api/sources/youtube");
    expect(JSON.parse(String(init.body))).toEqual({ url: video.url, credentials: { apiKey: "test" } });
    expect(addSource).toHaveBeenCalledWith(
      expect.objectContaining({
        title: video.title,
        kind: "text",
        url: video.url,
        text: `Source: ${video.url}\n\n[00:00] Talk about their life.`,
      }),
    );
  });

  it("reports the error Gemini sent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer(`${JSON.stringify({ error: "Quota exceeded." })}\n`)),
    );
    await expect(ingestYouTubeWithGemini("nb", video, { apiKey: "test" })).rejects.toMatchObject({
      reason: "read",
      detail: "Quota exceeded.",
    });
    expect(addSource).not.toHaveBeenCalled();
  });
});
