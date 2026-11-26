import type { TimedText } from "./transcript";

/** What the subtitle picker offers. */
export const SUBTITLE_EXTENSIONS = ["srt", "vtt"];
export const ACCEPTED_SUBTITLES = ".srt,.vtt,text/vtt,application/x-subrip";
export const MAX_SUBTITLE_BYTES = 10 * 1024 * 1024;

const timing =
  /((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)/;

/** `01:02:03,450`, `02:03.450` or `02:03` → seconds. */
export function cueTime(value: string): number {
  const [clock, fraction = "0"] = value.trim().split(/[.,]/);
  const parts = clock.split(":").map(Number);
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds + Number(`0.${fraction}`);
}

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lrm: "",
  rlm: "",
};

/** A cue's text without VTT/HTML tags, SSA override codes or entities. */
export function cueText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
      if (name[0] === "#") {
        const code =
          name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return entities[name.toLowerCase()] ?? match;
    })
    .replace(/[ \t\u00a0]+/g, " ")
    .trim();
}

/**
 * Reads SRT or WebVTT subtitles into cues. Multi-line cues are joined, tags
 * removed, and the repeated lines of rolling captions (YouTube's automatic
 * subtitles repeat the previous line and grow the current one word by word)
 * are kept once.
 */
export function parseSubtitles(content: string): TimedText[] {
  const blocks = content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/);
  const cues: TimedText[] = [];
  let recent: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const at = lines.findIndex((line) => timing.test(line));
    if (at < 0) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(lines[0].trim())) continue;
    const [, from, to] = timing.exec(lines[at])!;
    const start = cueTime(from);
    const end = Math.max(start, cueTime(to));
    const fresh: string[] = [];
    const seen: string[] = [];
    for (const line of lines.slice(at + 1).map(cueText)) {
      if (!line) continue;
      seen.push(line);
      if (recent.includes(line)) continue;
      // A line that grows the previous one: keep only the new words.
      const grown = recent.find((previous) => line.startsWith(`${previous} `));
      fresh.push(grown ? line.slice(grown.length).trim() : line);
    }
    if (seen.length) recent = seen;
    const text = fresh.join(" ").trim();
    const last = cues.at(-1);
    if (!text) {
      if (last && seen.length) last.end = Math.max(last.end, end);
      continue;
    }
    if (last && last.text === text && start <= last.end + 0.5) {
      last.end = Math.max(last.end, end);
      continue;
    }
    cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}
