export function locateStudyQuote(text: string, quote: string, previousOffset = 0): number {
  if (!quote) return -1;
  if (text.slice(previousOffset, previousOffset + quote.length) === quote) return previousOffset;
  const before = previousOffset > 0 ? text.lastIndexOf(quote, previousOffset) : -1;
  const after = text.indexOf(quote, previousOffset);
  if (before < 0) return after;
  if (after < 0) return before;
  return previousOffset - before <= after - previousOffset ? before : after;
}
