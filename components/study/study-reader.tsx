import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowLeft01Icon, ArrowRight01Icon, FullScreenIcon, MinimizeScreenIcon } from "@hugeicons/core-free-icons";
import { Link, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { StudyMarkdown, StudyText } from "./study-text";
import { StudyDocumentEdits } from "./study-document-edits";
import { StudyDocumentSearch } from "./study-document-search";
import { highlightColors } from "./study-highlight-colors";
import { flashcardMaterialLimit, flashcardPassageSize } from "@/lib/study/ai";
import { flashcardDraftRanges } from "@/lib/study/flashcard-material";
import { directionalInline, DirectionalText } from "@/components/common/directional-text";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { StudyEpubChapter, type StudyEpubTheme } from "./study-epub-chapter";
import { StudyPdfPage } from "./study-pdf-page";
import { StudyVisualCard, type VisualFlashcard } from "./study-visual-card";
import { StudyFlashcardDraftDialog, type FlashcardSource } from "./study-flashcard-generator";
import { renderedSelection, renderedStudyRange, useRenderedStudyMarks } from "./study-rendered-text";
import { useStudyReadingPlace } from "./study-reading-place";
import { Input } from "@/components/panelui/input";
import { Textarea } from "@/components/panelui/textarea";
import { Menu } from "@/components/panelui/menu";
import { loadBlob } from "@/lib/db/blobs";
import { useSource } from "@/lib/db/sources";
import { studyReturnState } from "@/lib/study/return-links";
import {
  freshSchedule,
  putStudyRecords,
  recordStudyActivity,
  saveStudyCard,
  saveStudyNote,
  saveStudyWord,
  studyId,
  updateStudyBook,
} from "@/lib/db/study";
import { routes } from "@/lib/routes";
import { textDirection, textLines } from "@/lib/text/direction";
import { askStudyModel } from "@/lib/study/client";
import { originHref, studyHref, studyNotesHref } from "@/lib/study/links";
import {
  studyHighlightColor,
  type StudyBook,
  type StudyHighlightColor,
  type StudyOrigin,
  type StudyRecordOf,
  type StudyThread,
  type StudyVisualOrigin,
} from "@/lib/study/records";
import type { StudyImageCapture } from "@/lib/study/visual-card";
import { locateStudyMark, resolveStudyRange, studyTextRevision } from "@/lib/study/text-edits";
import { studyDocumentFormulaMode } from "@/lib/study/markdown-document";

type Selection = { text: string; offset: number; revision: number };
type AssistResult = {
  action: "explain" | "translate";
  text: string;
  selection: Selection;
  language: string;
};

function highlighted(
  text: string,
  highlights: StudyRecordOf<"highlight">[],
  focus?: { offset: number; length: number },
) {
  const candidates = highlights.flatMap(({ id, offset, quote, color }) => {
    const end = offset + quote.length;
    if (focus && offset < focus.offset + focus.length && end > focus.offset) return [];
    return text.slice(offset, end) === quote ? [{ id, offset, end, color }] : [];
  });
  if (focus)
    candidates.push({
      id: "focused-passage",
      offset: focus.offset,
      end: focus.offset + focus.length,
      color: "blue",
    });
  let lastEnd = 0;
  const ranges = candidates
    .sort((a, b) => a.offset - b.offset)
    .filter(({ offset, end }) => {
      if (offset < lastEnd || offset >= end) return false;
      lastEnd = end;
      return true;
    });

  let start = 0;
  let rangeIndex = 0;
  return textLines(text).map((line) => {
    const direction = textDirection(line);
    const end = start + line.length;
    let at = start;
    const content: ReactNode[] = [];
    for (; rangeIndex < ranges.length; rangeIndex++) {
      const range = ranges[rangeIndex];
      if (range.offset >= end) break;
      const from = Math.max(at, range.offset);
      const to = Math.min(end, range.end);
      if (from > at) content.push(directionalInline(text.slice(at, from), direction));
      content.push(
        <mark
          id={range.offset >= start ? range.id : undefined}
          key={range.id}
          className={highlightColors[range.color]}
        >
          {directionalInline(text.slice(from, to), direction)}
        </mark>,
      );
      at = to;
      if (range.end > end) break;
    }
    if (at < end) content.push(directionalInline(text.slice(at, end), direction));
    const lineOffset = start;
    start = end;
    return (
      <span key={lineOffset} dir={direction} className="block">
        {content}
      </span>
    );
  });
}

export function StudyReader({
  book,
  viewport,
  vaultId,
  requestedPage,
  reference,
  focusedHighlight,
  focusedRange,
  focusedVisual,
  highlights,
  openPage,
  resume,
  openPassage,
  startChat,
  startImageChat,
  openingTutor,
  layoutCheckpoint,
  focused,
  toggleFocus,
  back,
}: {
  book: StudyBook;
  viewport: HTMLDivElement | null;
  vaultId: string;
  requestedPage?: number;
  reference: boolean;
  focusedHighlight?: string;
  focusedRange?: { offset: number; length: number; revision?: number };
  focusedVisual?: StudyVisualOrigin;
  highlights: StudyRecordOf<"highlight">[];
  openPage: (section: number) => void;
  resume: () => void;
  openPassage: (section: number, range: { offset: number; length: number }) => void;
  startChat: (
    scope: "passage" | "chapter" | "book",
    section: number,
    selection?: Selection,
    goal?: "teach-back",
    initial?: StudyThread["messages"],
  ) => void;
  startImageChat: (section: number, capture: StudyImageCapture) => void;
  openingTutor: boolean;
  layoutCheckpoint: RefObject<(() => void) | null>;
  focused: boolean;
  toggleFocus: () => void;
  back: () => void;
}) {
  const [openedSection] = useState(book.section);
  const index = Math.min(Math.max(0, requestedPage ?? openedSection), book.sections.length - 1);
  const section = book.sections[index];
  const markdown = section.markdown;
  const formulaMode = useMemo(
    () => markdown === undefined ? undefined : studyDocumentFormulaMode(markdown, section.text),
    [markdown, section.text],
  );
  const [paintedMath, setPaintedMath] = useState<string>();
  const onMathReady = useCallback(() => setPaintedMath(markdown), [markdown]);
  const waitingMath = Boolean(formulaMode) && paintedMath !== markdown;
  const revision = studyTextRevision(book);
  const navigate = useNavigate();
  const location = useLocation();
  const returnState = studyReturnState(location.state);
  const readerParams = new URLSearchParams(location.search);
  const visitingPassage = reference || !!(focusedHighlight || focusedRange || focusedVisual);
  const { t } = useTranslation("home");
  const focusLabel = t(focused ? "study.reader.exitFullscreen" : "study.reader.fullscreen");
  const source = useSource(book.sourceId);
  const fileId = source === null ? undefined : book.fileId;
  const hasPageText = Boolean(section.text.trim());
  const hasBookText = book.sections.some(({ text }) => text.trim());
  const needsOriginal = !hasPageText && !!fileId && book.format !== "text";
  const selectedHighlight = highlights.find((item) => item.id === focusedHighlight);
  const anchor =
    selectedHighlight?.section === index ? locateStudyMark(book, selectedHighlight) : -1;
  const focus =
    anchor >= 0 && selectedHighlight
      ? { offset: anchor, length: selectedHighlight.quote.length }
      : focusedRange && resolveStudyRange(book, requestedPage ?? index, focusedRange);
  const focusStart = focus?.offset;
  const focusLength = focus?.length;
  const missingPassage = Boolean((focusedRange || focusedHighlight) && !focus);
  const textBody = useRef<HTMLElement>(null);
  const passageNotice = useRef<HTMLParagraphElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [cardFront, setCardFront] = useState<string | null>(null);
  const [cardBack, setCardBack] = useState("");
  const [draftSource, setDraftSource] = useState<FlashcardSource | null>(null);
  const [cardSaving, setCardSaving] = useState(false);
  const [visualCard, setVisualCard] = useState<{ capture: StudyImageCapture; section: number }>();
  const [language, setLanguage] = useState("");
  const [translating, setTranslating] = useState(false);
  const [color, setColor] = useState<StudyHighlightColor>("yellow");
  const [editingSection, setEditingSection] = useState<number>();
  const [font, setFont] = useState(18);
  const [zoom, setZoom] = useState(100);
  const [epubTheme, setEpubTheme] = useState<StudyEpubTheme>("system");
  const [surfaceChoice, setSurfaceChoice] = useState<{ visit: string; surface: "text" | "layout" }>();
  const [savingSurface, setSavingSurface] = useState(false);
  const previousPlace = book.readingPlace;
  const savedSurface = previousPlace && book.sections[previousPlace.section]?.text.trim()
    ? previousPlace.surface
    : undefined;
  const showLayout = needsOriginal || (
    (surfaceChoice?.visit === location.key ? surfaceChoice.surface : undefined) ??
      (focusedVisual ? "layout" : undefined) ??
      book.preferredReadingSurface ?? savedSurface
  ) === "layout";
  const [readingSurface, setReadingSurface] = useState<{ section: number; root: HTMLElement | null }>();
  const viewPdf = showLayout && book.format === "pdf";
  const viewEpub = showLayout && book.format === "epub";
  const showingOriginal = Boolean((viewPdf || viewEpub) && fileId);
  const layout =
    showingOriginal && readingSurface?.section === index ? readingSurface.root : undefined;
  const loadingLayout = showingOriginal && layout === undefined;
  const [result, setResult] = useState<AssistResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [originalFile, setOriginalFile] = useState<{ url: string; mime: string }>();
  const pendingAssist = useRef<AbortController | null>(null);
  const started = useRef(0);
  const [readingSessionId] = useState(studyId);
  const latestInteraction = useRef(0);
  const restoredLayout = useStudyReadingPlace({
    book,
    section: index,
    revision,
    visit: location.key,
    viewport,
    article: textBody,
    layout,
    loadingLayout: waitingMath || loadingLayout,
    renderedArticle: markdown !== undefined,
    enabled: !visitingPassage && editingSection !== index,
    activity: latestInteraction,
    layoutCheckpoint,
  });
  const pageHighlights = useMemo(
    () =>
      highlights.flatMap((item) => {
        if (item.section !== index) return [];
        const offset = locateStudyMark(book, item);
        return offset < 0 ? [] : [{ ...item, offset }];
      }),
    [book, highlights, index],
  );
  const focusMark = useMemo(
    () =>
      focusStart === undefined || focusLength === undefined
        ? undefined
        : { offset: focusStart, quote: section.text.slice(focusStart, focusStart + focusLength) },
    [focusStart, focusLength, section.text],
  );
  const renderedMarks = useMemo(
    () =>
      focusMark
        ? [
            ...pageHighlights.filter(
              ({ offset, quote }) =>
                offset >= focusMark.offset + focusMark.quote.length ||
                offset + quote.length <= focusMark.offset,
            ),
            { ...focusMark, color: "blue" as const },
          ]
        : pageHighlights,
    [focusMark, pageHighlights],
  );
  useRenderedStudyMarks(textBody, !waitingMath && markdown !== undefined, section.text, renderedMarks);
  const bookmarkPlaces = book.bookmarkPlaces ?? [];
  const visualKind = focusedVisual?.kind;
  const figure = focusedVisual?.kind === "epub" ? focusedVisual.figure : undefined;
  const pageTop = focusedVisual?.kind === "pdf" ? focusedVisual.top : undefined;

  useEffect(() => {
    if (!visitingPassage) void updateStudyBook(book.id, { section: index });
  }, [book.id, index, visitingPassage]);

  useEffect(() => {
    started.current = Date.now();
    latestInteraction.current = started.current;
    const checkpoint = () => {
      const now = Date.now();
      const end = Math.min(now, latestInteraction.current + 60_000);
      const seconds = (end - started.current) / 1000;
      started.current = now;
      if (seconds >= 1) {
        void recordStudyActivity({
          activity: "reading",
          seconds,
          notebookId: book.notebookId,
          origin: { kind: "book", bookId: book.id, section: index },
          activitySessionId: readingSessionId,
        });
      }
    };
    function visibility() {
      if (document.visibilityState === "hidden") {
        checkpoint();
      } else {
        started.current = Date.now();
        latestInteraction.current = started.current;
      }
    }
    function whileReading() {
      if (document.visibilityState === "visible") checkpoint();
    }
    const heartbeat = window.setInterval(whileReading, 30_000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", whileReading);
    return () => {
      pendingAssist.current?.abort();
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", whileReading);
      whileReading();
    };
  }, [book.id, book.notebookId, index, readingSessionId]);

  useEffect(() => {
    let live = true;
    let url: string | undefined;
    if (fileId)
      void loadBlob(fileId).then((blob) => {
        if (!live || !blob) return;
        url = URL.createObjectURL(blob);
        setOriginalFile({ url, mime: blob.type });
      });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId]);

  useEffect(() => {
    if (waitingMath || loadingLayout || restoredLayout.current === location.key) return;
    if (focusMark) {
      const renderedRoot = layout ?? (markdown !== undefined ? textBody.current : null);
      const range = renderedRoot && renderedStudyRange(renderedRoot, section.text, focusMark);
      const line =
        range && Array.from(range.getClientRects()).find(({ width, height }) => width > 0 && height > 0);
      if (line && viewport) {
        const position = line.top - viewport.getBoundingClientRect().top;
        viewport.scrollBy({ top: position - viewport.clientHeight / 2, behavior: "instant" });
        return;
      }
      textBody.current?.querySelector("#focused-passage")?.scrollIntoView({ block: "center" });
    } else if (layout && viewport && visualKind === "pdf" && pageTop !== undefined) {
      const bounds = layout.getBoundingClientRect();
      const top = bounds.top + bounds.height * (pageTop / 10_000);
      viewport.scrollBy({
        top: top - viewport.getBoundingClientRect().top - 32,
        behavior: "instant",
      });
    } else if (layout && visualKind === "epub" && figure !== undefined) {
      const picture = layout.querySelector<HTMLImageElement>(`img[data-study-figure="${figure}"]`);
      if (!picture) return;
      const center = () => picture.scrollIntoView({ block: "center", behavior: "instant" });
      center();
      if (!picture.complete) {
        picture.addEventListener("load", center, { once: true });
        return () => picture.removeEventListener("load", center);
      }
    } else if (missingPassage) {
      passageNotice.current?.scrollIntoView({ block: "nearest" });
    }
  }, [
    focusMark,
    figure,
    layout,
    loadingLayout,
    location.key,
    markdown,
    missingPassage,
    pageTop,
    restoredLayout,
    section.text,
    viewport,
    visualKind,
    waitingMath,
  ]);

  function clearSelection() {
    setSelection(null);
    setCardFront(null);
    setDraftSource(null);
    setTranslating(false);
    pendingAssist.current?.abort();
  }

  function go(page: number) {
    clearSelection();
    setVisualCard(undefined);
    setEditingSection(undefined);
    setResult(null);
    openPage(page);
  }

  function openVisualCard(capture: StudyImageCapture) {
    clearSelection();
    setVisualCard({ capture, section: index });
  }

  async function saveVisualCard({ visual, ...content }: VisualFlashcard, section: number) {
    const card = await saveStudyCard({
      ...content,
      notebookId: book.notebookId,
      vaultId,
      tags: [book.title],
      origin: { kind: "book", bookId: book.id, section, visual },
    });
    setVisualCard(undefined);
    toast.success(t("study.visualCard.saved"), {
      action: {
        label: t("study.visualCard.review"),
        onClick: () => navigate(studyHref("review", { card: card.id, vault: vaultId })),
      },
    });
  }

  async function toggleLayout(visible: boolean) {
    if (savingSurface || visible === showLayout) return;
    const preferredReadingSurface = visible ? "layout" : "text";
    setSavingSurface(true);
    try {
      await updateStudyBook(book.id, { preferredReadingSurface });
      if (!visible) setReadingSurface(undefined);
      setSurfaceChoice({ visit: location.key, surface: preferredReadingSurface });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingSurface(false);
    }
  }

  function selectPassage(selected: Omit<Selection, "revision">) {
    latestInteraction.current = Date.now();
    setCardFront(null);
    setResult(null);
    pendingAssist.current?.abort();
    setSelection({ ...selected, revision });
  }

  function capture() {
    if (waitingMath || !hasPageText) return;
    latestInteraction.current = Date.now();
    if (markdown !== undefined && textBody.current) {
      captureRendered(textBody.current);
      return;
    }
    const selected = window.getSelection();
    if (!selected?.rangeCount || selected.isCollapsed || !textBody.current) return;
    const range = selected.getRangeAt(0);
    if (!textBody.current.contains(range.commonAncestorContainer)) return;
    const prefix = range.cloneRange();
    prefix.selectNodeContents(textBody.current);
    prefix.setEnd(range.startContainer, range.startOffset);
    const raw = range.toString();
    if (!raw.trim()) return;
    selectPassage({
      text: raw.trim().slice(0, 3000),
      offset: prefix.toString().length + raw.length - raw.trimStart().length,
    });
  }

  function captureRendered(root: HTMLElement) {
    if (!hasPageText) return;
    const selected = renderedSelection(root, section.text);
    if (selected === undefined) return;
    if (selected === null) {
      toast.error("Select this passage in the extracted text below to use it in Study.");
      return;
    }
    selectPassage(selected);
  }

  function sourceOf(selected?: Selection | null): Extract<StudyOrigin, { kind: "book" }> {
    return selected
      ? {
          kind: "book",
          bookId: book.id,
          section: index,
          offset: selected.offset,
          length: selected.text.length,
          revision: selected.revision,
        }
      : { kind: "book", bookId: book.id, section: index };
  }

  async function assist(action: AssistResult["action"]) {
    const selected = selection;
    if (!selected) return;
    const controller = new AbortController();
    pendingAssist.current?.abort();
    pendingAssist.current = controller;
    setBusy(true);
    setResult(null);
    const quote = selected.text;
    try {
      const response = await askStudyModel({
        action,
        input: action === "translate" ? `Language: ${language}\nText: ${quote}` : quote,
        passages: [{ title: section.title, text: quote }],
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setResult({ action, text: response.text, selection: selected, language });
    } catch (error) {
      if (!controller.signal.aborted)
        toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (pendingAssist.current === controller) {
        pendingAssist.current = null;
        setBusy(false);
      }
    }
  }

  function makeNote(selected: Selection, body = selected.text) {
    void saveStudyNote({
      title: `${book.title} · ${section.title}`,
      body,
      origin: sourceOf(selected),
      notebookId: book.notebookId,
    })
      .then((note) =>
        toast.success("Saved to Notes", {
          action: {
            label: "Open note",
            onClick: () =>
              navigate(originHref({ kind: "note", noteId: note.id }), { state: returnState }),
          },
        }),
      )
      .catch((error: Error) => toast.error(error.message));
  }

  function draftCards(text: string, selected?: Selection) {
    const origin = sourceOf(selected);
    const draftEvidence = (offset: number, length: number) =>
      Array.from({ length: Math.ceil(length / flashcardPassageSize) }, (_, part) => {
        const start = part * flashcardPassageSize;
        return {
          ...origin,
          offset: offset + start,
          length: Math.min(flashcardPassageSize, length - start),
          revision: selected?.revision ?? revision,
        };
      });
    const parts = flashcardDraftRanges(text).map(({ offset, length }) => ({
      preview: text.slice(offset, offset + Math.min(length, 100)).replace(/\s+/g, " "),
      load: () => ({
        text: text.slice(offset, offset + length),
        origin: { ...origin, offset: (selected?.offset ?? 0) + offset, length, revision: selected?.revision ?? revision },
        evidence: draftEvidence((selected?.offset ?? 0) + offset, length),
      }),
    }));
    setDraftSource({
      title: `${book.title} · ${section.title}`,
      text,
      origin,
      evidence: draftEvidence(selected?.offset ?? 0, Math.min(text.length, flashcardMaterialLimit)),
      notebookId: book.notebookId,
      tags: [book.title],
      parts,
    });
  }

  function bookmarkSelection(selected: Selection) {
    if (
      bookmarkPlaces.some(
        (place) =>
          place.section === index &&
          locateStudyMark(book, place) === selected.offset &&
          place.quote === selected.text,
      )
    ) {
      toast.info("This passage is already bookmarked.");
      return;
    }
    void updateStudyBook(book.id, {
      bookmarkPlaces: [
        ...bookmarkPlaces,
        {
          id: studyId(),
          section: index,
          offset: selected.offset,
          quote: selected.text,
          revision: selected.revision,
        },
      ],
    })
      .then(() => toast.success("Passage bookmarked"))
      .catch((error: Error) => toast.error(error.message));
  }

  function saveVocabulary(selected: Selection) {
    const translated =
      result?.action === "translate" && result.selection === selected ? result : null;
    void saveStudyWord({
      origin: sourceOf(selected),
      term: selected.text,
      translation: translated?.text ?? "",
      context: section.text.slice(
        Math.max(0, selected.offset - 100),
        selected.offset + selected.text.length + 100,
      ),
      language: translated?.language ?? language,
      note: "",
      notebookId: book.notebookId,
      bookId: book.id,
      vaultId,
    })
      .then((word) =>
        toast.success("Saved to vocabulary", {
          action: {
            label: "View word",
            onClick: () =>
              navigate(originHref({ kind: "word", wordId: word.id }), { state: returnState }),
          },
        }),
      )
      .catch((error: Error) => toast.error(error.message));
  }

  return (
    <section
      className="space-y-5"
      onKeyDown={(event) => {
        if (
          searchInput.current &&
          event.key.toLowerCase() === "f" &&
          (event.metaKey || event.ctrlKey) &&
          !event.altKey && !event.shiftKey &&
          event.target instanceof Node && event.currentTarget.contains(event.target)
        ) {
          event.preventDefault();
          searchInput.current.select();
          searchInput.current.focus();
        }
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Button size="sm" variant="ghost" onClick={back}>
            ← Library
          </Button>
          <h2 className="text-xl font-semibold wrap-break-word" dir={textDirection(book.title)}>
            {book.title}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {visitingPassage ? (
            <Button variant="outline" onClick={resume}>
              {t("study.reader.resume")}
            </Button>
          ) : null}
          <Link
            to={routes.notebook(book.notebookId)}
            state={returnState}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-accent"
          >
            Open notebook
          </Link>
          <Link
            className="rounded-lg border px-3 py-2 text-sm hover:bg-accent"
            to={studyNotesHref(book.notebookId)}
            state={returnState}
          >
            Notes
          </Link>
          <Link
            className="rounded-lg border px-3 py-2 text-sm hover:bg-accent"
            to={studyHref("cards", { book: book.id })}
            state={returnState}
          >
            Flashcards
          </Link>
          <Link
            className="rounded-lg border px-3 py-2 text-sm hover:bg-accent"
            to={studyHref("highlights", { book: book.id })}
            state={returnState}
          >
            Highlights
          </Link>
          {fileId && originalFile ? (
            <a
              href={originalFile.url}
              download={source?.fileName ?? `${book.title}.${book.format === "text" ? (originalFile.mime === "text/markdown" ? "md" : "txt") : book.format}`}
              className="rounded-lg border px-3 py-2 text-sm hover:bg-accent"
            >
              Download original
            </a>
          ) : null}
          {book.format === "pdf" && fileId && !needsOriginal ? (
            <Button variant="outline" disabled={savingSurface} onClick={() => void toggleLayout(!viewPdf)}>
              {viewPdf ? "Hide original page" : "Show original page"}
            </Button>
          ) : null}
          {book.format === "epub" && fileId && !needsOriginal ? (
            <Button variant="outline" disabled={savingSurface} onClick={() => void toggleLayout(!viewEpub)}>
              {viewEpub ? "Hide book layout" : "Show book layout"}
            </Button>
          ) : null}
        </div>
      </div>
      {source === null ? (
        <p className="text-sm text-muted-foreground">{t("study.capture.sourceRemoved")}</p>
      ) : null}
      <div
        data-study-reader-toolbar
        data-window-bar={focused ? "" : undefined}
        className="sticky top-0 z-20 space-y-1.5 rounded-2xl border bg-card p-2"
        role="region"
        aria-label={t("study.reader.controls")}
      >
        {focused ? <p className="truncate px-2 text-sm font-medium" dir="auto">{book.title}</p> : null}
        <div className="flex items-center gap-1.5">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("study.reader.previous")}
            title={t("study.reader.previous")}
            disabled={index === 0}
            onClick={() => go(index - 1)}
          >
            <Icon icon={ArrowLeft01Icon} size={16} className="rtl:rotate-180" />
          </Button>
          <select
            className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm sm:max-w-md"
            aria-label={t("study.reader.position")}
            value={index}
            onChange={(event) => go(Number(event.target.value))}
          >
            {book.sections.map((chapter, i) => (
              <option key={i} value={i}>
                {chapter.title}
              </option>
            ))}
          </select>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("study.reader.next")}
            title={t("study.reader.next")}
            disabled={index === book.sections.length - 1}
            onClick={() => go(index + 1)}
          >
            <Icon icon={ArrowRight01Icon} size={16} className="rtl:rotate-180" />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={focusLabel} title={focusLabel} onClick={toggleFocus} className="ms-auto">
            <Icon icon={focused ? MinimizeScreenIcon : FullScreenIcon} size={17} />
          </Button>
        </div>
        {hasBookText ? (
          <StudyDocumentSearch
            input={searchInput}
            sections={book.sections}
            active={focus && { section: index, ...focus }}
            open={({ section, offset, length }) => {
              clearSelection();
              setVisualCard(undefined);
              setEditingSection(undefined);
              setResult(null);
              openPassage(section, { offset, length });
            }}
            study={({ offset, length }) => {
              selectPassage({ text: section.text.slice(offset, offset + length), offset });
            }}
          />
        ) : null}
      </div>
      <div className="grid gap-3 rounded-2xl border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void updateStudyBook(book.id, {
                bookmarks: book.bookmarks.includes(index)
                  ? book.bookmarks.filter((at) => at !== index)
                  : [...book.bookmarks, index],
              })
            }
          >
            {book.bookmarks.includes(index) ? "Remove bookmark" : "Bookmark"}
          </Button>
          <label className="flex items-center gap-2 text-sm">
            Text size{" "}
            <input
              type="range"
              min={14}
              max={28}
              value={font}
              onChange={(event) => setFont(Number(event.target.value))}
            />
          </label>
        </div>
        {book.bookmarks.length || bookmarkPlaces.length ? (
          <div className="flex flex-wrap gap-2 text-sm">
            <span>Bookmarks</span>
            {book.bookmarks.map((at) => (
              <button
                key={at}
                type="button"
                className="cursor-pointer underline"
                onClick={() => go(at)}
              >
                {book.sections[at]?.title ?? at + 1}
              </button>
            ))}
            {bookmarkPlaces.map((place) => {
              const { id, section, quote, offset } = place;
              const at = locateStudyMark(book, place);
              return (
                <div key={id} className="flex items-center gap-1 rounded-md bg-muted ps-2">
                  <Link
                    className="max-w-56 truncate underline"
                    to={originHref({
                      kind: "book",
                      bookId: book.id,
                      section,
                      offset: at < 0 ? offset : at,
                      length: quote.length,
                      revision: at < 0 ? place.revision : revision,
                    }, readerParams)}
                    state={returnState}
                  >
                    {quote}
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove bookmark for ${quote}`}
                    onClick={() =>
                      void updateStudyBook(book.id, {
                        bookmarkPlaces: bookmarkPlaces.filter((place) => place.id !== id),
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}
        {missingPassage ? (
          <p role="status" ref={passageNotice} className="text-sm text-muted-foreground">
            {t("study.reader.passageChanged")}{" "}
            <button
              type="button"
              className="cursor-pointer underline underline-offset-4"
              hidden={!hasBookText}
              onClick={() => searchInput.current?.focus()}
            >
              {t("study.reader.search")}
            </button>
          </p>
        ) : null}
        {selectedHighlight && (missingPassage || selectedHighlight.note.trim()) ? (
          <div className="space-y-3 rounded-xl border bg-muted/25 p-3 text-sm">
            {missingPassage ? (
              <div>
                <p className="font-medium">{t("study.highlights.savedExcerpt")}</p>
                <blockquote className="mt-1">
                  <StudyText text={selectedHighlight.quote} className="wrap-break-word" />
                </blockquote>
              </div>
            ) : null}
            {selectedHighlight.note.trim() ? (
              <div>
                <p className="font-medium">{t("study.highlights.annotation")}</p>
                <DirectionalText
                  multiline
                  text={selectedHighlight.note}
                  className="mt-1 wrap-break-word whitespace-pre-wrap"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={openingTutor || !hasPageText} onClick={() => startChat("chapter", index)}>
          Discuss this {book.format === "pdf" ? "page" : "chapter"}
        </Button>
        <Button size="sm" variant="outline" disabled={openingTutor || !hasBookText} onClick={() => startChat("book", index)}>
          Discuss the book
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!hasPageText}
          onClick={() => draftCards(section.text)}
        >
          {t("study.capture.cardsFromSection")}
        </Button>
      </div>
      {book.format === "text" && !book.attachedToNotebook ? (
        <StudyDocumentEdits
          key={index}
          book={book}
          section={index}
          vaultId={vaultId}
          open={editingSection === index}
          onOpenChange={(open) => setEditingSection(open ? index : undefined)}
          onSave={clearSelection}
        />
      ) : null}
      <div className="space-y-4 rounded-2xl border bg-card p-5 sm:p-8">
        {viewPdf && fileId ? (
          <>
            <label className="flex items-center gap-2 text-sm">
              PDF zoom
              <input
                type="range"
                min={75}
                max={200}
                step={25}
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
              <span>{zoom}%</span>
            </label>
            <StudyPdfPage
              key={index}
              fileId={fileId}
              page={index}
              sectionText={section.text}
              marks={renderedMarks}
              zoom={zoom}
              onSelect={captureRendered}
              onReadingSurface={setReadingSurface}
              onVisual={openVisualCard}
              onDiscuss={(capture) => startImageChat(index, capture)}
            />
          </>
        ) : null}
        {viewEpub && fileId ? (
          <>
            <label className="flex items-center gap-2 text-sm">
              Reading theme
              <select
                value={epubTheme}
                className="rounded-lg border bg-background p-2"
                onChange={(event) => setEpubTheme(event.target.value as StudyEpubTheme)}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="sepia">Sepia</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <StudyEpubChapter
              key={index}
              fileId={fileId}
              section={section}
              index={index}
              sections={book.sections}
              marks={renderedMarks}
              font={font}
              theme={epubTheme}
              go={go}
              onSelect={captureRendered}
              onReadingSurface={setReadingSurface}
              onVisual={openVisualCard}
              onDiscuss={(capture) => startImageChat(index, capture)}
            />
          </>
        ) : null}
        <article
          ref={textBody}
          tabIndex={0}
          aria-label={section.title}
          className={`mx-auto max-w-prose leading-relaxed wrap-break-word outline-none focus-visible:ring-2 focus-visible:ring-ring ${markdown === undefined ? "whitespace-pre-wrap" : "markdown study-math"}`}
          style={{ fontSize: font }}
          onMouseUp={capture}
          onTouchEnd={capture}
          onKeyUp={capture}
          onPointerMove={() => {
            latestInteraction.current = Date.now();
          }}
        >
          {markdown !== undefined ? (
            <StudyMarkdown bare imageAltOnly math={formulaMode} onMathReady={onMathReady} text={markdown} />
          ) : hasPageText ? (
            highlighted(section.text, pageHighlights, focus)
          ) : (
            t("study.reader.noSelectableText")
          )}
        </article>
      </div>
      {selection ? (
        <div
          aria-label={t("study.capture.selectionActions")}
          className="sticky bottom-3 z-10 space-y-2 rounded-2xl border bg-popover p-3 shadow"
        >
          <div className="flex items-start justify-between gap-3">
            <StudyText
              text={selection.text}
              className="min-w-0 line-clamp-2 text-sm text-muted-foreground"
            />
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              {t("study.capture.dismiss")}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                void putStudyRecords({
                  id: studyId(),
                  kind: "highlight",
                  bookId: book.id,
                  notebookId: book.notebookId,
                  section: index,
                  quote: selection.text,
                  offset: selection.offset,
                  revision: selection.revision,
                  color,
                  note: "",
                  updatedAt: Date.now(),
                  schedule: freshSchedule(),
                })
                  .then(clearSelection)
                  .catch((error: Error) => toast.error(error.message));
              }}
            >
              Highlight
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void assist("explain")}
            >
              Explain
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={openingTutor}
              onClick={() => startChat("passage", index, selection, "teach-back")}
            >
              {t("study.capture.practice")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setCardFront("");
                setCardBack(selection.text);
              }}
            >
              Make flashcard
            </Button>
            <Menu>
              <Menu.Trigger render={<Button size="sm" variant="ghost" />}>
                {t("study.capture.more")}
              </Menu.Trigger>
              <Menu.Content align="end">
                <Menu.Item disabled={openingTutor} onClick={() => startChat("passage", index, selection)}>
                  Ask about selection
                </Menu.Item>
                <Menu.Item onClick={() => draftCards(selection.text, selection)}>
                  {t("study.capture.cardsFromSelection")}
                </Menu.Item>
                <Menu.Item onClick={() => makeNote(selection)}>Save to Notes</Menu.Item>
                <Menu.Item onClick={() => bookmarkSelection(selection)}>
                  Bookmark selection
                </Menu.Item>
                <Menu.Item onClick={() => setTranslating(true)}>Translate</Menu.Item>
                <Menu.Item onClick={() => saveVocabulary(selection)}>Save vocabulary</Menu.Item>
                <Menu.Separator />
                <Menu.Group>
                  <Menu.GroupLabel>{t("study.highlights.colorLabel")}</Menu.GroupLabel>
                  <Menu.RadioGroup
                    value={color}
                    onValueChange={(value) => {
                      const choice = studyHighlightColor.safeParse(value);
                      if (choice.success) setColor(choice.data);
                    }}
                  >
                    {studyHighlightColor.options.map((name) => (
                      <Menu.RadioItem key={name} value={name} closeOnClick>
                        {t(`study.highlights.colors.${name}`)}
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioGroup>
                </Menu.Group>
              </Menu.Content>
            </Menu>
          </div>
          {translating ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (language.trim() && !busy) void assist("translate");
              }}
            >
              <Input
                className="max-w-40"
                aria-label="Translate to"
                placeholder="Language"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              />
              <Button type="submit" size="sm" variant="outline" disabled={busy || !language.trim()}>
                Translate
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setTranslating(false)}>
                {t("study.capture.dismiss")}
              </Button>
            </form>
          ) : null}
          {cardFront !== null ? (
            <form
              className="flex flex-wrap items-start gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (cardSaving || !cardFront.trim() || !cardBack.trim()) return;
                setCardSaving(true);
                void saveStudyCard({
                  front: cardFront.trim(),
                  back: cardBack.trim(),
                  tags: [book.title],
                  notebookId: book.notebookId,
                  origin: sourceOf(selection),
                })
                  .then(() => {
                    setCardFront(null);
                    toast.success("Flashcard created", {
                      action: {
                        label: "View flashcards",
                        onClick: () =>
                          navigate(studyHref("cards", { book: book.id }), { state: returnState }),
                      },
                    });
                  })
                  .catch((error: Error) => toast.error(error.message))
                  .finally(() => setCardSaving(false));
              }}
            >
              <Input
                value={cardFront}
                dir={textDirection(cardFront)}
                onChange={(event) => setCardFront(event.target.value)}
                aria-label="Front of flashcard"
                placeholder="Question to review"
                className="max-w-sm"
              />
              <Textarea
                value={cardBack}
                dir={textDirection(cardBack)}
                onChange={(event) => setCardBack(event.target.value)}
                aria-label={t("study.capture.flashcardAnswer")}
                size="sm"
                minRows={1}
                maxRows={4}
                className="basis-full sm:flex-1"
              />
              <Button
                type="submit"
                size="sm"
                disabled={cardSaving || !cardFront.trim() || !cardBack.trim()}
              >
                Save flashcard
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCardFront(null)}>
                Cancel
              </Button>
            </form>
          ) : null}
          {busy ? (
            <p className="text-sm text-muted-foreground" role="status">
              {t("study.capture.working")}
            </p>
          ) : null}
          {result && result.selection === selection ? (
            <div className="max-h-[40dvh] space-y-2 overflow-auto border-t pt-2">
              <StudyText prose text={result.text} />
              <div className="flex flex-wrap gap-1">
                {result.action === "explain" && result.text.trim() ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={openingTutor}
                    onClick={() => startChat("passage", index, selection, undefined, [
                      { role: "user", text: t("study.reader.explainPassage") },
                      { role: "assistant", text: result.text, citations: [{ index: 1, title: book.title, origin: sourceOf(selection) }] },
                    ])}
                  >
                    {t("study.reader.continueWithTutor")}
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" onClick={() => makeNote(selection, result.text)}>
                  {t("study.capture.saveAnswer")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => draftCards(result.text, selection)}
                >
                  {t("study.capture.cardsFromAnswer")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {visualCard ? (
        <StudyVisualCard
          capture={visualCard.capture}
          onClose={() => setVisualCard(undefined)}
          onSave={(card) => saveVisualCard(card, visualCard.section)}
        />
      ) : null}
      {draftSource ? (
        <StudyFlashcardDraftDialog
          source={draftSource}
          vaultId={vaultId}
          onClose={() => setDraftSource(null)}
          onSave={(count) =>
            toast.success(t("study.capture.cardsSaved", { count }), {
              action: {
                label: t("study.capture.viewCards"),
                onClick: () =>
                  navigate(studyHref("cards", { book: book.id }), { state: returnState }),
              },
            })
          }
        />
      ) : null}
    </section>
  );
}
