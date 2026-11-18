import { useLayoutEffect, useRef, type RefObject } from "react";
import { saveStudyReadingPlace } from "@/lib/db/study";
import type { StudyBook, StudyReadingPlace } from "@/lib/study/records";
import { locateStudyMark } from "@/lib/study/text-edits";
import { canonicalRenderedRange, renderedStudyRange } from "./study-rendered-text";

const readingInset = (view: HTMLElement) => Math.min(48, view.clientHeight / 8);

function visibleText(root: HTMLElement, y: number) {
  const bounds = root.getBoundingClientRect();
  if (y < bounds.top || y >= bounds.bottom || bounds.width === 0) return;
  const left = bounds.left + Math.min(16, bounds.width / 3);
  const right = bounds.right - Math.min(16, bounds.width / 3);
  const rtl = getComputedStyle(root).direction === "rtl";
  for (const x of [rtl ? right : left, (left + right) / 2, rtl ? left : right]) {
    const caret = document.caretPositionFromPoint?.(x, y);
    const range = new Range();
    if (caret) range.setStart(caret.offsetNode, caret.offset);
    else {
      const fallback = document.caretRangeFromPoint?.(x, y);
      if (!fallback) continue;
      range.setStart(fallback.startContainer, fallback.startOffset);
    }
    const node = range.startContainer;
    if (!(node instanceof Text) || !node.length || !root.contains(node)) continue;
    const offset = Math.min(range.startOffset, node.length - 1);
    range.setStart(node, offset);
    range.setEnd(node, Math.min(offset + 64, node.length));
    if (range.toString().trim()) return range;
  }
}

function textRangeAt(root: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let before = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text)) continue;
    if (offset < before + node.length) {
      const range = new Range();
      range.setStart(node, offset - before);
      range.setEnd(node, offset - before + 1);
      return range;
    }
    before += node.length;
  }
}

function capturePlace(
  viewport: HTMLElement,
  article: HTMLElement,
  layout: HTMLElement | null | undefined,
  canonical: string,
  section: number,
  revision: number,
): StudyReadingPlace {
  const y = viewport.getBoundingClientRect().top + readingInset(viewport);
  const layoutBounds = layout?.getBoundingClientRect();
  const inLayout = layoutBounds && y <= layoutBounds.bottom;
  const root = (inLayout && layout) || article;
  const bounds = root.getBoundingClientRect();
  const progress = Math.min(1, Math.max(0, (y - bounds.top) / Math.max(1, bounds.height)));
  const place: StudyReadingPlace = { section, surface: inLayout ? "layout" : "text", progress };
  if (!canonical || viewport.scrollTop <= 1) return place;
  const range = visibleText(root, y);
  if (!range) return place;
  if (inLayout) {
    const anchor = canonicalRenderedRange(root, range, canonical, 64);
    if (anchor) place.anchor = { offset: anchor.offset, quote: anchor.text.slice(0, 96), revision };
  } else {
    const prefix = range.cloneRange();
    prefix.selectNodeContents(root);
    prefix.setEnd(range.startContainer, range.startOffset);
    const offset = prefix.toString().length;
    const quote = canonical.slice(offset, offset + 64).trimEnd();
    if (quote.trim()) place.anchor = { offset, quote, revision };
  }
  return place;
}

function restorePlace(
  viewport: HTMLElement,
  article: HTMLElement,
  layout: HTMLElement | null | undefined,
  book: StudyBook,
  place: StudyReadingPlace,
) {
  const root = (place.surface === "layout" && layout) || article;
  if (place.progress === 0 && !place.anchor) {
    viewport.scrollTo({ top: 0, behavior: "instant" });
    return;
  }
  const canonical = book.sections[place.section]?.text ?? "";
  const anchor = place.anchor;
  const offset = anchor ? locateStudyMark(book, { ...anchor, section: place.section }) : -1;
  const range = anchor && offset >= 0
    ? root === article
      ? textRangeAt(root, offset)
      : renderedStudyRange(root, canonical, { offset, quote: anchor.quote })
    : undefined;
  const line = range?.getClientRects()[0];
  const bounds = root.getBoundingClientRect();
  const top = line?.top ?? bounds.top + bounds.height * place.progress;
  viewport.scrollBy({
    top: top - viewport.getBoundingClientRect().top - readingInset(viewport),
    behavior: "instant",
  });
}

export function useStudyReadingPlace({
  book,
  section,
  revision,
  visit,
  viewport,
  article,
  layout,
  loadingLayout,
  enabled,
  activity,
}: {
  book: StudyBook;
  section: number;
  revision: number;
  visit: string;
  viewport: HTMLDivElement | null;
  article: RefObject<HTMLElement | null>;
  layout: HTMLElement | null | undefined;
  loadingLayout: boolean;
  enabled: boolean;
  activity: RefObject<number>;
}) {
  const currentBook = useRef(book);
  const restored = useRef<string | undefined>(undefined);
  const id = book.id;
  const canonical = book.sections[section]?.text ?? "";

  useLayoutEffect(() => {
    currentBook.current = book;
  }, [book]);

  useLayoutEffect(() => {
    const root = article.current;
    const scroll = viewport;
    if (!enabled || !root || !scroll) return;
    if (restored.current !== visit) {
      const place = currentBook.current.readingPlace;
      if (place?.section === section) {
        if (loadingLayout) return;
        restorePlace(scroll, root, layout, currentBook.current, place);
      } else scroll.scrollTo({ top: 0, behavior: "instant" });
      restored.current = visit;
    }
    if (loadingLayout) return;

    let lastTop = scroll.scrollTop;
    let changedAt: number | undefined;
    let timer = 0;
    let sample = 0;
    let captured: StudyReadingPlace | undefined;
    function measure() {
      if (root?.isConnected && scroll?.isConnected)
        captured = capturePlace(scroll, root, layout, canonical, section, revision);
    }
    function flush() {
      window.clearTimeout(timer);
      window.clearTimeout(sample);
      sample = 0;
      if (changedAt === undefined) return;
      measure();
      if (captured) void saveStudyReadingPlace(id, captured, changedAt).catch(console.error);
      changedAt = undefined;
    }
    function onScroll() {
      if (!scroll || Math.abs(scroll.scrollTop - lastTop) < 1) return;
      lastTop = scroll.scrollTop;
      changedAt = Date.now();
      activity.current = changedAt;
      if (!sample) sample = window.setTimeout(() => {
        sample = 0;
        measure();
      }, 80);
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, 320);
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") flush();
    }
    scroll.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      scroll.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [activity, article, canonical, enabled, id, layout, loadingLayout, revision, section, viewport, visit]);
}
