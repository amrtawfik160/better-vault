import { useEffect, type RefObject } from "react";
import { locateStudyQuote } from "@/lib/study/locators";
import { studyHighlightColor, type StudyRecordOf } from "@/lib/study/records";

type Mark = Pick<StudyRecordOf<"highlight">, "quote" | "offset" | "color">;
const compact = (text: string) => text.replace(/\s/gu, "");

export function renderedSelection(root: HTMLElement, canonical: string) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;
  return canonicalRenderedRange(root, range, canonical, 3_000);
}

export function canonicalRenderedRange(root: HTMLElement, range: Range, canonical: string, limit: number) {
  const quote = compact(range.toString().trim().slice(0, limit));
  if (!quote) return;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  const expected = compact(prefix.toString()).length;
  const at = locateStudyQuote(compact(canonical), quote, expected);
  if (at < 0) return null;

  let offset = 0;
  let count = 0;
  while (offset < canonical.length && count <= at) {
    if (!/\s/u.test(canonical[offset]) && count++ === at) break;
    offset++;
  }
  let end = offset;
  while (end < canonical.length && count < at + quote.length) {
    end++;
    if (end < canonical.length && !/\s/u.test(canonical[end])) count++;
  }
  return { offset, text: canonical.slice(offset, end + 1) };
}

function renderedTextIndex(root: HTMLElement) {
  const pieces: { node: Text; offset: number }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text)) continue;
    for (let offset = 0; offset < node.length; offset++) {
      const char = node.data[offset];
      if (/\s/u.test(char)) continue;
      text += char;
      pieces.push({ node, offset });
    }
  }
  return { text, pieces };
}

function locateRenderedRange(
  { text, pieces }: ReturnType<typeof renderedTextIndex>,
  canonical: string,
  mark: Pick<Mark, "quote" | "offset">,
) {
  const quote = compact(mark.quote);
  if (!quote) return;
  const expected = compact(canonical.slice(0, mark.offset)).length;
  const start = locateStudyQuote(text, quote, expected);
  const first = pieces[start];
  const last = pieces[start + quote.length - 1];
  if (!first || !last) return;
  const range = new Range();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}

export function renderedStudyRange(root: HTMLElement, canonical: string, mark: Pick<Mark, "quote" | "offset">) {
  return locateRenderedRange(renderedTextIndex(root), canonical, mark);
}

export function useRenderedStudyMarks(
  root: RefObject<HTMLElement | null>,
  ready: boolean,
  canonical: string,
  marks: Mark[],
) {
  useEffect(() => {
    const region = root.current;
    if (!ready || !region || !globalThis.CSS?.highlights || !marks.length) return;
    const indexed = renderedTextIndex(region);
    const colored = new Map(studyHighlightColor.options.map((color) => [color, new Highlight()]));
    for (const mark of marks) {
      const range = locateRenderedRange(indexed, canonical, mark);
      if (range) colored.get(mark.color)?.add(range);
    }
    for (const [color, highlighting] of colored) {
      if (highlighting.size) CSS.highlights.set(`study-${color}`, highlighting);
    }
    return () => {
      for (const color of colored.keys()) CSS.highlights.delete(`study-${color}`);
    };
  }, [root, ready, canonical, marks]);
}
