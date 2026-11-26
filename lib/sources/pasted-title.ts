/** A pasted text's title: its first sentence or line, cut at a word, not mid-word. */
export function pastedTitle(text: string, max = 60) {
  const line = text.split("\n", 1)[0]?.trim() ?? "";
  const sentence = /^(.{12,}?[.!?])(\s|$)/.exec(line)?.[1] ?? line;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:–-]+$/, "")}…`;
}
