/**
 * YouTube videos as sources: recognising a video's address, and reading its
 * title, length and captions from YouTube's own player data, the way its
 * mobile apps ask for them. No key is needed, and nothing about the user is sent.
 */
import type { TimedText } from "./transcript";

const ID = /^[\w-]{11}$/;
const HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

/** The video's id in a YouTube address (watch, youtu.be, shorts, embed, live), or `null`. */
export function youtubeVideoId(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be" || host === "www.youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (HOSTS.has(host)) {
    const [first, second] = url.pathname.split("/").filter(Boolean);
    if (first === "watch") id = url.searchParams.get("v");
    else if (["shorts", "embed", "live", "v", "e"].includes(first ?? "")) id = second ?? null;
  }
  return id && ID.test(id) ? id : null;
}

/** The video's watch address, the one kept with the source. */
export const youtubeWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  /** `asr` for captions YouTube made from the speech. */
  kind?: string;
}

/**
 * The captions to save: ones written by people in the language spoken (the
 * language of YouTube's automatic captions tells which that is), else the
 * automatic ones, else the video's default track, else the first.
 */
export function pickCaptionTrack(
  tracks: readonly CaptionTrack[],
  defaultIndex?: number,
): CaptionTrack | undefined {
  const auto = tracks.find((track) => track.kind === "asr");
  const written = tracks.filter((track) => track.kind !== "asr");
  if (auto) {
    const spoken = auto.languageCode.split("-")[0];
    return written.find((track) => track.languageCode.split("-")[0] === spoken) ?? auto;
  }
  const preferred = defaultIndex === undefined ? undefined : tracks[defaultIndex];
  return preferred ?? written[0];
}

interface Json3 {
  events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[];
}

/** YouTube's `json3` caption format as timed pieces of speech. */
export function json3Cues(data: Json3): TimedText[] {
  const cues: TimedText[] = [];
  for (const event of data.events ?? []) {
    if (!event.segs || event.tStartMs === undefined) continue;
    const text = event.segs
      .map((seg) => seg.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const start = event.tStartMs / 1000;
    cues.push({ start, end: start + (event.dDurationMs ?? 0) / 1000, text });
  }
  return cues;
}

export interface YouTubeVideo {
  id: string;
  title: string;
  author: string;
  /** The video's length in seconds (0 for a live stream). */
  seconds: number;
  /** The captions, when the video has any. */
  captions?: { language: string; auto: boolean; cues: TimedText[] };
}

/** Why YouTube would not share a video's details. */
export class YouTubeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YouTubeError";
  }
}

// The mobile apps' player data lists caption tracks that can be read without a
// browser session; the web player's often can't. The second is a fallback.
const CLIENTS = [
  {
    client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30 },
    userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
  },
  {
    client: { clientName: "IOS", clientVersion: "20.10.4", deviceModel: "iPhone16,2" },
    userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
  },
] as const;

interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: { title?: string; author?: string; lengthSeconds?: string; isLive?: boolean };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
      audioTracks?: { defaultCaptionTrackIndex?: number }[];
    };
  };
}

async function player(id: string, signal: AbortSignal) {
  let last: unknown;
  for (const { client, userAgent } of CLIENTS) {
    try {
      const response = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", "user-agent": userAgent },
        body: JSON.stringify({ context: { client: { ...client, hl: "en" } }, videoId: id }),
      });
      if (!response.ok) throw new Error(`YouTube answered ${response.status}.`);
      const data = (await response.json()) as PlayerResponse;
      if (data.playabilityStatus?.status === "OK") return { data, userAgent };
      last = new YouTubeError(unplayable(data.playabilityStatus));
    } catch (error) {
      if (signal.aborted) throw error;
      last = error;
    }
  }
  throw last instanceof Error ? last : new YouTubeError("YouTube didn't answer. Try again.");
}

function unplayable(status: PlayerResponse["playabilityStatus"]): string {
  switch (status?.status) {
    case "LOGIN_REQUIRED":
      return "YouTube only shows this video to signed-in viewers (it may be private or age-restricted).";
    case "ERROR":
      return "This video isn't available. It may have been removed, or the address is wrong.";
    default:
      return status?.reason
        ? `YouTube won't share this video: ${status.reason}`
        : "YouTube won't share this video.";
  }
}

/** Reads a video's title, length and captions from YouTube. */
export async function fetchYouTubeVideo(
  id: string,
  { timeout = 20_000 }: { timeout?: number } = {},
): Promise<YouTubeVideo> {
  if (!ID.test(id)) throw new YouTubeError("That isn't a YouTube video address.");
  const signal = AbortSignal.timeout(timeout);
  const { data, userAgent } = await player(id, signal);
  const details = data.videoDetails ?? {};
  const video: YouTubeVideo = {
    id,
    title: details.title?.trim() || `YouTube video ${id}`,
    author: details.author?.trim() ?? "",
    seconds: Number(details.lengthSeconds) || 0,
  };
  const list = data.captions?.playerCaptionsTracklistRenderer;
  const track = pickCaptionTrack(
    list?.captionTracks ?? [],
    list?.audioTracks?.[0]?.defaultCaptionTrackIndex,
  );
  if (!track) return video;
  const address = new URL(track.baseUrl);
  if (!address.hostname.endsWith(".youtube.com") && address.hostname !== "youtube.com")
    return video;
  address.searchParams.set("fmt", "json3");
  const response = await fetch(address, { signal, headers: { "user-agent": userAgent } });
  if (!response.ok) return video;
  const cues = json3Cues((await response.json().catch(() => ({}))) as Json3);
  if (cues.length) {
    video.captions = { language: track.languageCode, auto: track.kind === "asr", cues };
  }
  return video;
}

/**
 * About how many tokens Gemini reads for a video at low resolution: a frame a
 * second (66 tokens) and the sound (32 tokens a second), rounded up.
 */
export const geminiVideoTokens = (seconds: number) => Math.ceil((seconds * 100) / 1000) * 1000;

/** The longest video Gemini is asked to transcribe (its context holds about this much). */
export const GEMINI_MAX_SECONDS = 3 * 60 * 60;
