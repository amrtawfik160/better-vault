export function locateStudyQuote(text: string, quote: string, previousOffset = 0): number {
  if (!quote) return -1;
  if (text.slice(previousOffset, previousOffset + quote.length) === quote) return previousOffset;
  const before = previousOffset > 0 ? text.lastIndexOf(quote, previousOffset) : -1;
  const after = text.indexOf(quote, previousOffset);
  if (before < 0) return after;
  if (after < 0) return before;
  return previousOffset - before <= after - previousOffset ? before : after;
}

export type StudySearchMatch = { section: number; offset: number; length: number };

/** Searches the reader's canonical text while keeping offsets into the unmodified section. */
export function searchStudyDocument(
  sections: readonly { text: string }[],
  query: string,
): StudySearchMatch[] {
  const phrase = query.trim();
  if (!phrase) return [];
  const literal = phrase.split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(literal.join("\\s+"), "giu");
  return sections.flatMap(({ text }, section) =>
    Array.from(text.matchAll(pattern), (match) => ({
      section,
      offset: match.index,
      length: match[0].length,
    })),
  );
}

const compact = (text: string) => text.trim().replace(/\s+/g, " ");

export function locateCitedChunk<T extends { id: string; text: string }>(
  chunks: T[],
  id: string | undefined,
  excerpt: string | undefined,
): T | undefined {
  const original = chunks.find((chunk) => chunk.id === id);
  if (!excerpt) return original;
  const query = compact(excerpt);
  if (!query) return original;
  if (original && compact(original.text).includes(query)) return original;
  const matches = chunks.filter(({ text }) => compact(text).includes(query));
  return matches.length === 1 ? matches[0] : undefined;
}

/** Finds an imported excerpt even when the notebook normalized its whitespace. */
export function findStudyExcerpt(
  sections: { text: string }[],
  excerpt: string,
): { section: number; offset: number; length: number } | undefined {
  const query = compact(excerpt);
  if (!query) return;
  let found: { section: number; offset: number; length: number } | undefined;
  for (const [section, { text }] of sections.entries()) {
    const normalized = text.replace(/\s+/g, " ");
    const start = normalized.indexOf(query);
    if (start === -1) continue;
    if (found || normalized.indexOf(query, start + 1) !== -1) return;
    let offset = start;
    let length = query.length;
    if (normalized.length !== text.length) {
      const end = start + query.length - 1;
      let added = 0;
      let originalStart = start;
      for (const match of text.matchAll(/\s+/g)) {
        const at = match.index - added;
        if (at > end) break;
        added += match[0].length - 1;
        if (at < start) originalStart = start + added;
      }
      offset = originalStart;
      length = end + added + 1 - offset;
    }
    found = { section, offset, length };
  }
  if (found || sections.length <= 1) return found;

  // A notebook chunk can contain the end of one chapter and the start of another.
  const separator = "\n\n";
  const combined = sections.map(({ text }) => text).join(separator);
  const match = findStudyExcerpt([{ text: combined }], excerpt);
  if (!match) return;
  let offset = match.offset;
  for (const [section, { text }] of sections.entries()) {
    if (offset < text.length)
      return { section, offset, length: Math.min(match.length, text.length - offset) };
    offset -= text.length + separator.length;
  }
}
