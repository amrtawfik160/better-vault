import { flashcardMaterialLimit } from "./ai";

type Heading = { from: number; text: string };
export type FlashcardDraftRange = { offset: number; length: number; heading?: string };

function batchEnd(text: string, start: number, sectionEnd: number) {
  const limit = Math.min(sectionEnd, start + flashcardMaterialLimit);
  if (limit === sectionEnd) return limit;
  const nearEnd = limit - 750;
  const paragraph = text.lastIndexOf("\n\n", limit - 2);
  if (paragraph >= nearEnd) return paragraph + 2;
  const word = Math.max(text.lastIndexOf(" ", limit - 1), text.lastIndexOf("\n", limit - 1));
  if (word >= nearEnd) return word + 1;
  // Keep surrogate pairs together when an unbroken line reaches the limit.
  const preceding = text.charCodeAt(limit - 1);
  return preceding >= 0xd800 && preceding <= 0xdbff ? limit - 1 : limit;
}

/** Every nonblank part of long material, in order and in the source's coordinates. */
export function flashcardDraftRanges(text: string, headings: readonly Heading[] = []): FlashcardDraftRange[] {
  if (text.trim().length <= flashcardMaterialLimit) return [];
  const parts: FlashcardDraftRange[] = [];
  const sections = [{ from: 0, text: "" }, ...headings];
  let start = 0;
  for (const [index, section] of sections.entries()) {
    const end = sections[index + 1]?.from ?? text.length;
    if (section.text && end < text.length) {
      const headingEnd = text.indexOf("\n", section.from);
      if (headingEnd >= 0 && !text.slice(headingEnd + 1, end).trim()) continue;
    }
    while (start < end) {
      const stop = batchEnd(text, start, end);
      const raw = text.slice(start, stop);
      const content = raw.trim();
      if (content) {
        parts.push({
          offset: start + raw.length - raw.trimStart().length,
          length: content.length,
          heading: section.text || undefined,
        });
      }
      start = stop;
    }
  }
  return parts;
}
