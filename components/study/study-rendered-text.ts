import { useEffect, type RefObject } from "react";
import { locateStudyQuote } from "@/lib/study/locators";
import type { StudyRecordOf } from "@/lib/study/records";

type Mark = Pick<StudyRecordOf<"highlight">, "quote" | "offset" | "color">;
const markColors = ["yellow", "green", "blue", "pink"] as const;
const compact = (text: string) => text.replace(/\s/gu, "");

export function renderedSelection(root: HTMLElement, canonical: string) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;
  const quote = compact(range.toString().trim().slice(0, 3000));
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

export function useRenderedStudyMarks(
  root: RefObject<HTMLDivElement | null>,
  ready: boolean,
  canonical: string,
  marks: Mark[],
) {
  useEffect(() => {
    const region = root.current;
    if (!ready || !region || !globalThis.CSS?.highlights || !marks.length) return;
    const pieces: { node: Text; offset: number }[] = [];
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    let rendered = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node instanceof Text)) continue;
      for (let offset = 0; offset < node.length; offset++) {
        const char = node.data[offset];
        if (/\s/u.test(char)) continue;
        rendered += char;
        pieces.push({ node, offset });
      }
    }
    const colored = new Map(markColors.map((color) => [color, new Highlight()]));
    for (const mark of marks) {
      const quote = compact(mark.quote);
      if (!quote) continue;
      const offset = compact(canonical.slice(0, mark.offset)).length;
      const start = locateStudyQuote(rendered, quote, offset);
      if (start < 0) continue;
      const first = pieces[start];
      const last = pieces[start + quote.length - 1];
      const range = new Range();
      range.setStart(first.node, first.offset);
      range.setEnd(last.node, last.offset + 1);
      colored.get(mark.color)?.add(range);
    }
    for (const [color, highlighting] of colored) {
      if (highlighting.size) CSS.highlights.set(`study-${color}`, highlighting);
    }
    return () => {
      for (const color of markColors) CSS.highlights.delete(`study-${color}`);
    };
  }, [root, ready, canonical, marks]);
}
