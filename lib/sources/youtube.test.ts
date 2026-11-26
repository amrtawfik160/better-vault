import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeTimedTranscript } from "./transcript";
import {
  YouTubeError,
  fetchYouTubeTranscript,
  geminiVideoTokens,
  json3Cues,
  pickCaptionTrack,
  youTubeId,
} from "./youtube";

describe("youTubeId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=MT4Ig2uqjTc", "MT4Ig2uqjTc"],
    ["https://youtube.com/watch?v=MT4Ig2uqjTc&t=42s", "MT4Ig2uqjTc"],
    ["https://m.youtube.com/watch?v=MT4Ig2uqjTc", "MT4Ig2uqjTc"],
    ["https://youtu.be/MT4Ig2uqjTc?si=abc", "MT4Ig2uqjTc"],
    ["https://www.youtube.com/shorts/MT4Ig2uqjTc", "MT4Ig2uqjTc"],
    ["https://www.youtube.com/embed/MT4Ig2uqjTc", "MT4Ig2uqjTc"],
    ["https://www.youtube.com/live/MT4Ig2uqjTc?feature=share", "MT4Ig2uqjTc"],
    ["https://www.youtube-nocookie.com/embed/MT4Ig2uqjTc", "MT4Ig2uqjTc"],
    ["  https://youtu.be/MT4Ig2uqjTc  ", "MT4Ig2uqjTc"],
    ["https://music.youtube.com/watch?v=MT4Ig2uqjTc", "MT4Ig2uqjTc"],
  ])("reads %s", (address, id) => {
    expect(youTubeId(address)).toBe(id);
  });

  it.each([
    "https://www.youtube.com/",
    "https://www.youtube.com/@ycombinator",
    "https://www.youtube.com/channel/UC123",
    "https://www.youtube.com/playlist?list=PL123",
    "https://www.youtube.com/watch?v=short",
    "https://notyoutube.com/watch?v=MT4Ig2uqjTc",
    "https://example.com/youtu.be/MT4Ig2uqjTc",
    "ftp://youtu.be/MT4Ig2uqjTc",
    "not a link",
  ])("ignores %s", (address) => {
    expect(youTubeId(address)).toBeNull();
  });
});

describe("pickCaptionTrack", () => {
  const track = (languageCode: string, kind?: string) => ({
    baseUrl: `https://www.youtube.com/api/timedtext?lang=${languageCode}`,
    languageCode,
    kind,
  });

  it("prefers captions people wrote in the language spoken", () => {
    const tracks = [track("de-DE"), track("en"), track("en", "asr"), track("ja")];
    expect(pickCaptionTrack(tracks)).toEqual(track("en"));
  });

  it("takes the automatic captions when nobody wrote them in that language", () => {
    const tracks = [track("de"), track("es", "asr")];
    expect(pickCaptionTrack(tracks)).toEqual(track("es", "asr"));
  });

  it("uses the video's default track when nothing was spoken in a known language", () => {
    expect(pickCaptionTrack([track("fr"), track("ar")], 1)).toEqual(track("ar"));
    expect(pickCaptionTrack([track("fr"), track("ar")])).toEqual(track("fr"));
  });

  it("finds nothing without tracks", () => {
    expect(pickCaptionTrack([])).toBeUndefined();
  });
});

describe("json3Cues", () => {
  it("joins each event's pieces and skips empty ones", () => {
    const cues = json3Cues({
      events: [
        { tStartMs: 0, dDurationMs: 5000 },
        { tStartMs: 1200, dDurationMs: 3000, segs: [{ utf8: "Talk to " }, { utf8: "users" }] },
        { tStartMs: 4200, dDurationMs: 100, segs: [{ utf8: "\n" }] },
        { tStartMs: 4300, dDurationMs: 2000, segs: [{ utf8: "every   week." }] },
      ],
    });
    expect(cues).toEqual([
      { start: 1.2, end: 4.2, text: "Talk to users" },
      { start: 4.3, end: 6.3, text: "every week." },
    ]);
  });

  it("reads an empty answer as no cues", () => {
    expect(json3Cues({})).toEqual([]);
  });
});

describe("geminiVideoTokens", () => {
  it("estimates about a hundred tokens a second, rounded up to a thousand", () => {
    expect(geminiVideoTokens(2497)).toBe(250_000);
    expect(geminiVideoTokens(1)).toBe(1000);
  });
});

describe("normalizeTimedTranscript", () => {
  it("keeps one paragraph per time and writes the times the same way", () => {
    const raw = [
      "```",
      "[0:00] Talk about their life,",
      "not your idea.",
      "",
      "[01:05] Ask about specifics in the past.",
      "[1:02:05] Then listen.",
      "```",
    ].join("\n");
    expect(normalizeTimedTranscript(raw)).toBe(
      [
        "[00:00] Talk about their life, not your idea.",
        "[01:05] Ask about specifics in the past.",
        "[1:02:05] Then listen.",
      ].join("\n\n"),
    );
  });

  it("returns text without times as it is", () => {
    expect(normalizeTimedTranscript("  Just words.\n")).toBe("Just words.");
  });
});

describe("fetchYouTubeTranscript", () => {
  afterEach(() => vi.unstubAllGlobals());

  const playerAnswer = (body: object) => new Response(JSON.stringify(body), { status: 200 });

  it("saves the captions as timed paragraphs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (address: string | URL) =>
        String(address).includes("/player")
          ? playerAnswer({
              playabilityStatus: { status: "OK" },
              videoDetails: { title: "Talking to users", author: "YC", lengthSeconds: "70" },
              captions: {
                playerCaptionsTracklistRenderer: {
                  captionTracks: [{ baseUrl: "/api/timedtext?lang=en", languageCode: "en" }],
                },
              },
            })
          : playerAnswer({
              events: [
                { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "Talk to users." }] },
                { tStartMs: 65000, dDurationMs: 2000, segs: [{ utf8: "Every week." }] },
              ],
            }),
      ),
    );
    const result = await fetchYouTubeTranscript("MT4Ig2uqjTc");
    expect(result.title).toBe("Talking to users");
    expect(result.text).toBe("[00:01] Talk to users. Every week.");
    expect(result.video.url).toBe("https://www.youtube.com/watch?v=MT4Ig2uqjTc");
  });

  it("fails with the video when it has no captions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        playerAnswer({
          playabilityStatus: { status: "OK" },
          videoDetails: { title: "Silent film", author: "Someone", lengthSeconds: "1897" },
        }),
      ),
    );
    const failure = await fetchYouTubeTranscript("MT4Ig2uqjTc").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(YouTubeError);
    expect(failure).toMatchObject({
      reason: "no-captions",
      video: { id: "MT4Ig2uqjTc", title: "Silent film", seconds: 1897 },
    });
  });

  it("calls a video that needs signing in private", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => playerAnswer({ playabilityStatus: { status: "LOGIN_REQUIRED" } })),
    );
    await expect(fetchYouTubeTranscript("MT4Ig2uqjTc")).rejects.toMatchObject({
      reason: "private",
    });
  });
});
