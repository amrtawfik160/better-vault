const rtlScript =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}]/u;
const letter = /\p{L}/u;

export type TextDirection = "ltr" | "rtl" | "auto";

/** Technical terms can be much longer than the surrounding words. Count words by script. */
export function textDirection(text: string): TextDirection {
  if (!rtlScript.test(text)) return letter.test(text) ? "ltr" : "auto";
  let words = 0;
  let rtl = 0;
  for (const word of text.split(/\s+/u)) {
    const firstLetter = word.match(letter)?.[0];
    if (!firstLetter) continue;
    words++;
    if (rtlScript.test(firstLetter)) rtl++;
  }
  if (!words) return "auto";
  return rtl / words >= 0.4 ? "rtl" : "ltr";
}

/** Keep newline characters in the text so a DOM Range still maps to stored offsets. */
export function textLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
}

const latinRun =
  /[\p{Script=Latin}_][\p{Script=Latin}\p{M}\d_.+#/:()<>='’[\]-]*(?:[ \t]+[\p{Script=Latin}\d_][\p{Script=Latin}\p{M}\d_.+#/:()<>='’[\]-]*)*/gu;
const openings = new Map([
  [")", "("],
  ["]", "["],
  [">", "<"],
]);

export function leftToRightRuns(text: string): { text: string; ltr: boolean }[] {
  const runs: { text: string; ltr: boolean }[] = [];
  let at = 0;
  for (const match of text.matchAll(latinRun)) {
    const start = match.index;
    let end = match[0].length;
    while (end > 0) {
      const last = match[0][end - 1];
      const opening = openings.get(last);
      if (!".,:;!?".includes(last)) {
        if (!opening) break;
        const token = match[0].slice(0, end);
        if (token.split(last).length <= token.split(opening).length) break;
      }
      end--;
    }
    if (start > at) runs.push({ text: text.slice(at, start), ltr: false });
    at = start + end;
    runs.push({ text: text.slice(start, at), ltr: true });
  }
  if (at < text.length) runs.push({ text: text.slice(at), ltr: false });
  return runs;
}

/** Whether a text is mostly in a right-to-left script (Arabic, Hebrew, Syriac, Thaana). */
export function isRightToLeft(text: string): boolean {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const rtl =
    text.match(/[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}]/gu)
      ?.length ?? 0;
  return letters > 0 && rtl / letters > 0.3;
}
