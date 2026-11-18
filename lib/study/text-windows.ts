/** Windows keep their original offsets so results can point back into the document. */
export function* studyTextWindows(text: string, size = 1500) {
  for (let start = 0; start < text.length;) {
    const limit = Math.min(start + size, text.length);
    const boundary = text.lastIndexOf("\n", limit - 1);
    const end = limit !== text.length && boundary > limit - 250 ? boundary + 1 : limit;
    const part = text.slice(start, end);
    const content = part.trim();
    if (content) yield { start, offset: start + part.length - part.trimStart().length, text: content };
    if (end === text.length) break;
    start = Math.max(start + 1, end - 180);
  }
}
