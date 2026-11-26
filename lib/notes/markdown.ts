import { LINK, maskIgnored, parseLinkInner } from "./syntax";

type SourceRange = { from: number; to: number };
export type NoteMarkdown = {
  text: string;
  sourceRange: (from: number, to: number) => SourceRange;
};

type Replacement = SourceRange & { start: number; end: number };

function replacementAt(changes: Replacement[], position: number) {
  let low = 0;
  let high = changes.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (changes[middle].start <= position) low = middle + 1;
    else high = middle;
  }
  return changes[low - 1];
}

function rewrite(
  input: NoteMarkdown,
  pattern: RegExp,
  replace: (match: RegExpMatchArray) => string,
  mask = input.text,
  keepPrefix = 0,
): NoteMarkdown {
  const changes: Replacement[] = [];
  const originalPattern = new RegExp(pattern.source, pattern.flags.replace("g", ""));
  let text = "";
  let last = 0;
  for (const match of mask.matchAll(pattern)) {
    const position = match.index ?? 0;
    const to = position + match[0].length;
    const original = input.text.slice(position, to);
    const actual = original.match(originalPattern);
    if (!actual) continue;
    const prefixLength = keepPrefix ? (actual[keepPrefix]?.length ?? 0) : 0;
    const from = position + prefixLength;
    text += input.text.slice(last, from);
    const start = text.length;
    text += replace(actual).slice(prefixLength);
    changes.push({ from, to, start, end: text.length });
    last = to;
  }
  if (!changes.length) return input;
  text += input.text.slice(last);
  return {
    text,
    sourceRange(from, to) {
      const first = replacementAt(changes, from);
      const last = replacementAt(changes, to - 1);
      const start = first && from < first.end ? first.from : from + (first ? first.to - first.end : 0);
      const end = last && to - 1 < last.end ? last.to : to + (last ? last.to - last.end : 0);
      return input.sourceRange(start, end);
    },
  };
}

/** Markdown for the reader, with the original offsets of Obsidian links and highlights. */
export function noteMarkdown(body: string, offset = 0): NoteMarkdown {
  let markdown = rewrite(
    { text: body, sourceRange: (from, to) => ({ from: from + offset, to: to + offset }) },
    /%%[\s\S]*?%%/g,
    () => "",
  );
  markdown = rewrite(markdown, LINK, (match) => {
    const link = parseLinkInner(match[2], match[1] === "!");
    const label = (link.alias ?? [link.target, link.heading].filter(Boolean).join(" › ")) || match[2];
    return `[${label.replace(/[[\]]/g, "")}](${match[1] === "!" ? "embed" : "wl"}:${encodeURIComponent(match[2])})`;
  }, maskIgnored(markdown.text));
  markdown = rewrite(markdown, /==([^=\n]+)==/g, (match) => `[${match[1]}](hl:)`, maskIgnored(markdown.text));
  return rewrite(
    markdown,
    /(^|[\s([{,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu,
    (match) => `${match[1]}[#${match[2]}](tag:${encodeURIComponent(match[2])})`,
    maskIgnored(markdown.text),
    1,
  );
}
