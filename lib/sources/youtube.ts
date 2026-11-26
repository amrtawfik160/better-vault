import { transcriptText, type TimedText } from "./transcript";

/**
 * YouTube videos as sources, the way NotebookLM takes them: only the
 * transcript is imported, from the video's captions (written by the uploader
 * or made automatically), so a video needs to be public. The text keeps a
 * `[mm:ss]` mark at the start of each paragraph (`lib/sources/transcript.ts`),
 * so citations point at a moment in the video and the reader can start the
 * player there. A video without captions can still be transcribed by Gemini
 * (`server/routes/sources-youtube.ts`), which saves the same form.
 *
 * Runs on the server (the page's CSP doesn't allow YouTube). Only youtube.com
 * is ever fetched, whatever address was given. No key is needed, and nothing
 * about the user is sent.
 */

const HOST = "https://www.youtube.com";
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 5 * 1024 * 1024;
const ID = /^[\w-]{11}$/;

/** The video id in a YouTube address (watch, youtu.be, shorts, embed, live), or null. */
export function youTubeId(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, "");
  const valid = (id: string | null | undefined) => (id && ID.test(id) ? id : null);
  if (host === "youtu.be") return valid(url.pathname.split("/")[1]);
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  if (url.pathname === "/watch") return valid(url.searchParams.get("v"));
  const match = /^\/(?:shorts|embed|live|v|e)\/([\w-]{11})(?:[/?#]|$)/.exec(url.pathname);
  return valid(match?.[1]);
}

/** The address of a video, as it is saved with the source. */
export const youTubeWatchUrl = (id: string) => `${HOST}/watch?v=${id}`;

/** A video as the page needs it to offer another way to transcribe it. */
export interface YouTubeVideoInfo {
  id: string;
  title: string;
  author: string;
  /** The video's length in seconds (0 for a live stream). */
  seconds: number;
  url: string;
}

export type YouTubeFailure = "private" | "unavailable" | "no-captions";

export class YouTubeError extends Error {
  constructor(
    readonly reason: YouTubeFailure,
    /** For `no-captions`: the video, so it can be transcribed another way. */
    readonly video?: YouTubeVideoInfo,
  ) {
    super(
      reason === "no-captions"
        ? "This video has no captions, so there is no transcript to add."
        : reason === "private"
          ? "This video is private or restricted. Only public videos can be added."
          : "This video is not available.",
    );
    this.name = "YouTubeError";
  }
}

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

export interface YouTubeVideo extends YouTubeVideoInfo {
  /** The captions, when the video has any. */
  captions?: { language: string; auto: boolean; cues: TimedText[] };
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
  videoDetails?: { title?: string; author?: string; lengthSeconds?: string; isPrivate?: boolean };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
      audioTracks?: { defaultCaptionTrackIndex?: number }[];
    };
  };
}

async function get(url: string | URL, signal: AbortSignal, init?: RequestInit) {
  const response = await fetch(url, { ...init, redirect: "error", signal });
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) throw new Error("YouTube's answer was too large.");
  return response;
}

async function player(id: string, signal: AbortSignal) {
  let last: unknown;
  for (const { client, userAgent } of CLIENTS) {
    try {
      const response = await get(`${HOST}/youtubei/v1/player?prettyPrint=false`, signal, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": userAgent },
        body: JSON.stringify({ context: { client: { ...client, hl: "en" } }, videoId: id }),
      });
      if (!response.ok) throw new Error(`YouTube answered ${response.status}.`);
      const data = (await response.json()) as PlayerResponse;
      const status = data.playabilityStatus?.status;
      if (status === "OK" && !data.videoDetails?.isPrivate) return { data, userAgent };
      last = new YouTubeError(
        status === "LOGIN_REQUIRED" || data.videoDetails?.isPrivate ? "private" : "unavailable",
      );
    } catch (error) {
      if (signal.aborted) throw error;
      last = error;
    }
  }
  throw last instanceof Error ? last : new YouTubeError("unavailable");
}

/** Reads a public video's title, length and captions from YouTube. */
export async function fetchYouTubeVideo(
  id: string,
  { timeout = TIMEOUT_MS }: { timeout?: number } = {},
): Promise<YouTubeVideo> {
  if (!ID.test(id)) throw new YouTubeError("unavailable");
  const signal = AbortSignal.timeout(timeout);
  const { data, userAgent } = await player(id, signal);
  const details = data.videoDetails ?? {};
  const video: YouTubeVideo = {
    id,
    title: details.title?.trim() || `YouTube video ${id}`,
    author: details.author?.trim() ?? "",
    seconds: Number(details.lengthSeconds) || 0,
    url: youTubeWatchUrl(id),
  };
  const list = data.captions?.playerCaptionsTracklistRenderer;
  const track = pickCaptionTrack(
    list?.captionTracks ?? [],
    list?.audioTracks?.[0]?.defaultCaptionTrackIndex,
  );
  if (!track) return video;
  const address = new URL(track.baseUrl, HOST);
  if (address.hostname !== "www.youtube.com" && address.hostname !== "youtube.com") return video;
  address.searchParams.set("fmt", "json3");
  const response = await get(address, signal, { headers: { "user-agent": userAgent } });
  if (!response.ok) return video;
  const cues = json3Cues((await response.json().catch(() => ({}))) as Json3);
  if (cues.length) {
    video.captions = { language: track.languageCode, auto: track.kind === "asr", cues };
  }
  return video;
}

/** The video without its captions, as the page is told about it. */
const infoOf = ({ id, title, author, seconds, url }: YouTubeVideo): YouTubeVideoInfo => ({
  id,
  title,
  author,
  seconds,
  url,
});

/**
 * A public video's title and timed transcript, from its captions. Throws
 * `YouTubeError("no-captions")` with the video when it has none.
 */
export async function fetchYouTubeTranscript(
  id: string,
): Promise<{ title: string; text: string; author: string; video: YouTubeVideoInfo }> {
  const video = await fetchYouTubeVideo(id);
  const text = video.captions ? transcriptText(video.captions.cues) : "";
  if (!text) throw new YouTubeError("no-captions", infoOf(video));
  return { title: video.title, text, author: video.author, video: infoOf(video) };
}

/**
 * About how many tokens Gemini reads for a video at low resolution: a frame a
 * second (66 tokens) and the sound (32 tokens a second), rounded up.
 */
export const geminiVideoTokens = (seconds: number) => Math.ceil((seconds * 100) / 1000) * 1000;

/** The longest video Gemini is asked to transcribe (its context holds about this much). */
export const GEMINI_MAX_SECONDS = 3 * 60 * 60;
