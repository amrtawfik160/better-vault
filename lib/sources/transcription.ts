/**
 * Transcribing a recording with the user's own OpenAI or ElevenLabs key.
 * Shared by the page (limits shown before upload) and the server route.
 */
export const transcriptionProviderIds = ["elevenlabs", "openai"] as const;
export type TranscriptionProviderId = (typeof transcriptionProviderIds)[number];

const mediaTypes: Record<string, string> = {
  aac: "audio/aac",
  aiff: "audio/aiff",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mpeg: "audio/mpeg",
  mpga: "audio/mpeg",
  mkv: "video/x-matroska",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  webm: "video/webm",
};

export const transcriptionLimits: Record<
  TranscriptionProviderId,
  { maxBytes: number; extensions: readonly string[] }
> = {
  // OpenAI's speech-to-text guide: "Files can be up to 25 MB", in these formats.
  openai: {
    maxBytes: 25 * 1024 * 1024,
    extensions: ["mp3", "mp4", "mpeg", "mpga", "m4a", "ogg", "wav", "webm", "flac"],
  },
  // ElevenLabs takes up to 5 GB; the app holds the upload in memory, so it stops at 200 MB.
  elevenlabs: {
    maxBytes: 200 * 1024 * 1024,
    extensions: [
      "mp3",
      "m4a",
      "aac",
      "wav",
      "flac",
      "ogg",
      "opus",
      "aiff",
      "webm",
      "mp4",
      "mov",
      "mkv",
    ],
  },
};

export const extensionOf = (name: string) =>
  name.includes(".") ? (name.toLowerCase().split(".").pop() ?? "") : "";

/** The media type of a recording, from its name when the browser gave none. */
export function recordingMediaType(name: string, type: string): string | undefined {
  return mediaTypes[extensionOf(name)] ?? (/^(audio|video)\//.test(type) ? type : undefined);
}

/** The picker's `accept`: every format the provider takes (or either provider). */
export function acceptedRecordings(provider?: TranscriptionProviderId) {
  const extensions = provider
    ? transcriptionLimits[provider].extensions
    : [...new Set(transcriptionProviderIds.flatMap((id) => transcriptionLimits[id].extensions))];
  return ["audio/*", "video/*", ...extensions.map((extension) => `.${extension}`)].join(",");
}

export type TranscriptionProblem = "type" | "tooLarge";

/** Why a provider cannot take this file, checked before it is uploaded. */
export function recordingProblem(
  provider: TranscriptionProviderId,
  file: Pick<File, "name" | "size" | "type">,
): TranscriptionProblem | undefined {
  const { maxBytes, extensions } = transcriptionLimits[provider];
  const extension = extensionOf(file.name);
  const known = extension
    ? extensions.includes(extension)
    : recordingMediaType(file.name, file.type) !== undefined;
  if (!known) return "type";
  if (file.size > maxBytes) return "tooLarge";
}

/** A transcript paragraph as the server sends it. */
export interface TranscribedParagraph {
  start: number;
  text: string;
}

/** One line of the route's answer (newline-delimited JSON). */
export type TranscriptionEvent =
  | { status: "transcribing" }
  | { done: true; text: string; paragraphs: TranscribedParagraph[]; durationInSeconds?: number }
  | { error: string };
