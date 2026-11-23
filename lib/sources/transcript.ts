/**
 * Turns timed pieces of speech (subtitle cues, a provider's transcript
 * segments, a pasted YouTube transcript) into readable paragraphs that start
 * with `[mm:ss]` markers.
 */

/** A piece of speech with its start and end, in seconds. */
export interface TimedText {
  start: number;
  end: number;
  text: string;
}

export interface TimedParagraph {
  start: number;
  text: string;
}

/** `[mm:ss]` or `[h:mm:ss]` at the start of a line. */
export const timestampMarker = /^\[(?:\d+:)?\d{2}:\d{2}\]/;

/** `75` → `01:15`, `3725` → `1:02:05`. */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return hours ? `${hours}:${mmss}` : mmss;
}

/** `1:02:05`, `12:34` or `0:07` → seconds; `undefined` when it is not a timestamp. */
export function parseTimestamp(value: string): number | undefined {
  const match = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const [, hours = "0", minutes, seconds] = match;
  if (Number(seconds) > 59 || (match[1] !== undefined && Number(minutes) > 59)) return undefined;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

const sentenceEnd = /[.!?…。！？]["”’)\]]*$/u;
const leadingPunctuation = /^[,.;:!?…%)\]}”’]/u;

/**
 * Joins pieces of text: word-level pieces with their own spacing (ElevenLabs)
 * and phrase-level pieces without it (subtitles, OpenAI) both read naturally.
 */
export function joinPieces(pieces: readonly string[]): string {
  let text = "";
  for (const piece of pieces) {
    if (!piece) continue;
    if (!piece.trim()) {
      if (text && !/\s$/u.test(text)) text += " ";
      continue;
    }
    if (text && !/\s$/u.test(text) && !/^\s/u.test(piece) && !leadingPunctuation.test(piece))
      text += " ";
    text += piece;
  }
  return text.replace(/\s+/gu, " ").trim();
}

export interface ParagraphOptions {
  /** A paragraph may end at a sentence end or a pause once it is this long. */
  minSeconds?: number;
  /** A paragraph always ends once it is this long. */
  maxSeconds?: number;
  /** A gap this long counts as a pause. */
  pauseSeconds?: number;
  /** A gap this long ends a paragraph that has at least `minAfterSilence` seconds. */
  silenceSeconds?: number;
  minAfterSilence?: number;
}

/**
 * Merges cues into paragraphs of roughly one to one and a half minutes,
 * ending them at sentence ends or pauses where it can.
 */
export function timedParagraphs(
  cues: readonly TimedText[],
  {
    minSeconds = 60,
    maxSeconds = 90,
    pauseSeconds = 1.5,
    silenceSeconds = 5,
    minAfterSilence = 20,
  }: ParagraphOptions = {},
): TimedParagraph[] {
  const sorted = cues.filter(({ text }) => text.length > 0).sort((a, b) => a.start - b.start);
  const paragraphs: TimedParagraph[] = [];
  let pieces: string[] = [];
  let start = 0;
  const close = () => {
    const text = joinPieces(pieces);
    if (text) paragraphs.push({ start, text });
    pieces = [];
  };
  sorted.forEach((cue, index) => {
    if (!pieces.length) {
      if (!cue.text.trim()) return;
      start = cue.start;
    }
    pieces.push(cue.text);
    const next = sorted[index + 1];
    if (!next) return;
    const length = Math.max(cue.end, cue.start) - start;
    const gap = next.start - Math.max(cue.end, cue.start);
    const ends = sentenceEnd.test(cue.text.trim());
    if (
      length >= maxSeconds ||
      (length >= minSeconds && (ends || gap >= pauseSeconds)) ||
      (length >= minAfterSilence && gap >= silenceSeconds)
    )
      close();
  });
  close();
  return paragraphs;
}

/** Paragraphs as text: `[mm:ss] …`, separated by blank lines. */
export function paragraphsText(paragraphs: readonly TimedParagraph[]): string {
  return paragraphs.map(({ start, text }) => `[${formatTimestamp(start)}] ${text}`).join("\n\n");
}

/** Cues straight to the text of a document. */
export function transcriptText(cues: readonly TimedText[], options?: ParagraphOptions): string {
  return paragraphsText(timedParagraphs(cues, options));
}

// YouTube adds a spoken length under each time for screen readers ("2 minutes, 5 seconds").
const spokenLength =
  /^\d+\s+(?:hours?|minutes?|seconds?)(?:,?\s+\d+\s+(?:hours?|minutes?|seconds?))*$/i;
const inlineTime = /^((?:\d{1,2}:)?\d{1,2}:\d{2})\s+(\S.*)$/;

/**
 * Cleans a transcript copied from YouTube's "Show transcript" panel: a time
 * on its own line (or at the start of a line) followed by the words said.
 * Text that does not look like that comes back unchanged, only trimmed.
 */
export function cleanPastedTranscript(raw: string): string {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const cues: TimedText[] = [];
  const preamble: string[] = [];
  let current: TimedText | undefined;
  let timed = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const alone = parseTimestamp(trimmed);
    const inline = alone === undefined ? inlineTime.exec(trimmed) : null;
    const at = alone ?? (inline ? parseTimestamp(inline[1]) : undefined);
    if (at !== undefined) {
      timed++;
      current = { start: at, end: at, text: inline ? inline[2] : "" };
      cues.push(current);
      continue;
    }
    if (spokenLength.test(trimmed)) continue;
    if (current) current.text = current.text ? `${current.text} ${trimmed}` : trimmed;
    else preamble.push(trimmed);
  }
  const textLines = lines.filter((line) => line.trim()).length;
  // Not a timed transcript: at least three times, and a time for every few lines.
  if (timed < 3 || timed * 4 < textLines) return raw.trim();
  cues.forEach((cue, index) => {
    cue.end = cues[index + 1]?.start ?? cue.start;
  });
  const body = transcriptText(cues);
  return preamble.length ? `${preamble.join("\n")}\n\n${body}` : body;
}

/** The text of a transcript document, with the link to the video or episode first. */
export function transcriptDocument(text: string, link?: string): string {
  const url = link?.trim();
  return url ? `Source: ${url}\n\n${text.trim()}` : text.trim();
}
