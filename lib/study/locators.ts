export function locateStudyQuote(text: string, quote: string, previousOffset = 0): number {
  if (!quote) return -1;
  if (text.slice(previousOffset, previousOffset + quote.length) === quote) return previousOffset;
  const before = previousOffset > 0 ? text.lastIndexOf(quote, previousOffset) : -1;
  const after = text.indexOf(quote, previousOffset);
  if (before < 0) return after;
  if (after < 0) return before;
  return previousOffset - before <= after - previousOffset ? before : after;
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
export function findStudyExcerpt(sections: { text: string }[], excerpt: string) {
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
  return found;
}
