import { useEffect, type RefObject } from "react";
import { locateStudyQuote } from "@/lib/study/locators";
import { studyFormulaAttribute } from "@/lib/study/markdown-math";
import { studyHighlightColor, type StudyRecordOf } from "@/lib/study/records";

export type StudyTextMark = Pick<StudyRecordOf<"highlight">, "quote" | "offset" | "color">;
const compact = (text: string) => text.replace(/\s/gu, "");
const formulaSelector = `[${studyFormulaAttribute}]`;
const readingControl = "[data-study-reading-control]";
const projectedSelector = `${formulaSelector}, ${readingControl}`;

function projectionAt(node: Node) {
  return (node instanceof Element ? node : node.parentElement)?.closest(projectedSelector);
}

function projectedText(range: Range, projections: readonly Element[]) {
  const tail = range.cloneRange();
  let text = "";
  for (const element of projections) {
    if (!range.intersectsNode(element)) continue;
    const before = tail.cloneRange();
    before.setEndBefore(element);
    text += before.toString() + (element.getAttribute(studyFormulaAttribute) ?? "");
    tail.setStartAfter(element);
  }
  return text + tail.toString();
}

export function renderedSelection(root: HTMLElement, canonical: string) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;
  return canonicalRenderedRange(root, range, canonical, 3_000);
}

export function canonicalRenderedRange(
  root: HTMLElement,
  range: Range,
  canonical: string,
  limit: number,
) {
  const projections = Array.from(root.querySelectorAll(projectedSelector));
  const selection = range.cloneRange();
  const firstProjection = projectionAt(selection.startContainer);
  const lastProjection = projectionAt(selection.endContainer);
  if (firstProjection) selection.setStartBefore(firstProjection);
  if (lastProjection) selection.setEndAfter(lastProjection);
  const quote = compact(projectedText(selection, projections).trim().slice(0, limit));
  if (!quote) return;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(selection.startContainer, selection.startOffset);
  const expected = compact(projectedText(prefix, projections)).length;
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

type RenderedPiece = { node: Text; offset: number } | { node: Element };

function renderedTextIndex(root: HTMLElement) {
  const pieces: RenderedPiece[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (
        node.parentElement?.closest(projectedSelector) ||
        (node instanceof Element && node.matches(readingControl))
      )
        return NodeFilter.FILTER_REJECT;
      return node instanceof Text || (node instanceof Element && node.matches(formulaSelector))
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Element) {
      const source = compact(node.getAttribute(studyFormulaAttribute) ?? "");
      text += source;
      const piece = { node };
      for (let index = 0; index < source.length; index++) pieces.push(piece);
      continue;
    }
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
  mark: Pick<StudyTextMark, "quote" | "offset">,
) {
  const quote = compact(mark.quote);
  if (!quote) return;
  const expected = compact(canonical.slice(0, mark.offset)).length;
  const start = locateStudyQuote(text, quote, expected);
  const first = pieces[start];
  const last = pieces[start + quote.length - 1];
  if (!first || !last) return;
  const range = new Range();
  if ("offset" in first) range.setStart(first.node, first.offset);
  else range.setStartBefore(first.node);
  if ("offset" in last) range.setEnd(last.node, last.offset + 1);
  else range.setEndAfter(last.node);
  return range;
}

export function renderedStudyRange(
  root: HTMLElement,
  canonical: string,
  mark: Pick<StudyTextMark, "quote" | "offset">,
) {
  return locateRenderedRange(renderedTextIndex(root), canonical, mark);
}

export function useRenderedStudyMarks(
  root: RefObject<HTMLElement | null>,
  ready: boolean,
  canonical: string,
  marks: readonly StudyTextMark[],
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
