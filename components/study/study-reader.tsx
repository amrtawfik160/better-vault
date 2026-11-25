import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Bookmark02Icon,
  InformationCircleIcon,
  LeftToRightListBulletIcon,
  MoreHorizontalIcon,
  Search01Icon,
  SidebarRightIcon,
  TeachingIcon,
} from "@hugeicons/core-free-icons";
import { Link, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { StudyMarkdown, StudyText } from "./study-text";
import { timestampEnd, withTimestampChip } from "./study-timestamp";
import { StudyDocumentEdits } from "./study-document-edits";
import { StudyDocumentSearch } from "./study-document-search";
import { StudyReaderSettings } from "./study-reader-settings";
import {
  StudyReaderCompanion,
  useReaderCompanionLayout,
  type ReaderCompanionTab,
  type ReaderConversations,
  type ReaderTutor,
} from "./study-reader-companion";
import { StudyReaderContents, type ReaderContentsTab } from "./study-reader-contents";
import { usePartName, useReaderPractice } from "./study-reader-practise";
import type { ReaderChatSeed, ReaderQuote } from "./reader-chat";
import { ReaderTip } from "./study-reader-tip";
import { StudySelectionMenu, type SelectionMenuHandle, type StudySelection } from "./study-selection-menu";
import { highlightColors } from "./study-highlight-colors";
import { flashcardMaterialLimit, flashcardPassageSize } from "@/lib/study/ai";
import { flashcardDraftRanges } from "@/lib/study/flashcard-material";
import { DirectionalText } from "@/components/common/directional-text";
import { Icon } from "@/components/icon";
import { Alert } from "@/components/panelui/alert";
import { Button } from "@/components/panelui/button";
import { StudyEpubChapter } from "./study-epub-chapter";
import { StudyPdfPage } from "./study-pdf-page";
import { StudyPageOcr } from "./study-page-ocr";
import { StudyBatchOcr } from "./study-batch-ocr";
import { StudyVisualCard, type VisualFlashcard } from "./study-visual-card";
import { StudyImageDiscussion } from "./study-image-discussion";
import { StudyFlashcardDraftDialog, type FlashcardSource } from "./study-flashcard-generator";
import { renderedSelection, renderedStudyRange, useRenderedStudyMarks } from "./study-rendered-text";
import { useStudyReadingPlace } from "./study-reading-place";
import { Menu } from "@/components/panelui/menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { loadBlob } from "@/lib/db/blobs";
import { updateSettings, useSettings } from "@/lib/db/settings";
import { useSource } from "@/lib/db/sources";
import { studyReturnState } from "@/lib/study/return-links";
import {
  freshSchedule,
  putStudyRecords,
  readStudyOcrDraft,
  recordStudyActivity,
  removeStudyRecord,
  saveStudyNote,
  saveStudyVisualCard,
  studyId,
  updateStudyBook,
  updateStudyReviewItem,
} from "@/lib/db/study";
import { routes } from "@/lib/routes";
import { textDirection, textLines } from "@/lib/text/direction";
import { originHref, studyHighlightOrigin, studyHref, studyNotesHref } from "@/lib/study/links";
import { studyBookProgress } from "@/lib/study/reading-progress";
import { defaultTranslationLanguage } from "@/lib/study/translation-language";
import {
  defaultStudyReadingAppearance,
  type StudyBook,
  type StudyHighlightColor,
  type StudyOcrDraft,
  type StudyOrigin,
  type StudyReadingAppearance,
  type StudyReadingPlace,
  type StudyRecordOf,
  type StudyThread,
  type StudyVisualOrigin,
  type StudyWord,
} from "@/lib/study/records";
import type { StudyImageCapture } from "@/lib/study/visual-card";
import { locateStudyMark, resolveStudyRange, studyTextRevision } from "@/lib/study/text-edits";
import { studyDocumentFormulaMode } from "@/lib/study/markdown-document";
import { canEditStudyText } from "@/lib/study/library";
import { firstOpenStrip, leftOffLineStart, readerPart } from "@/lib/study/reader-companion";
import { StudyDocumentRemovalDialog, type StudyDocumentRemoval } from "./study-document-dialogs";
import { cn } from "@/lib/utils";

type Selection = StudySelection;
type Highlight = StudyRecordOf<"highlight">;

/** Open layers that close on Escape themselves: a menu, a list, a dialog other than the reader's panels. */
const escapeOwners =
  "[role=menu], [role=listbox], [data-slot=model-picker-content], [role=dialog]:not([data-study-selection-menu]), [role=alertdialog]";

const companionPreferenceKey = "deeple:reader-companion";
const firstOpenKey = (bookId: string) => `deeple:reader-first-open:${bookId}`;

/** Whether the companion column was last left open or closed, at full width. */
function readCompanionPreference() {
  try {
    return localStorage.getItem(companionPreferenceKey);
  } catch {
    return null;
  }
}
function rememberCompanionPreference(value: "open" | "closed") {
  try {
    localStorage.setItem(companionPreferenceKey, value);
  } catch {
    // Browser storage can be off; the companion then opens as it does the first time.
  }
}
function readFirstOpen(bookId: string) {
  try {
    return localStorage.getItem(firstOpenKey(bookId));
  } catch {
    return null;
  }
}
function rememberFirstOpen(bookId: string, value: "pending" | "done") {
  try {
    localStorage.setItem(firstOpenKey(bookId), value);
  } catch {
    // Without browser storage the strip shows on new documents until dismissed in this visit.
  }
}

/** Keys that belong to the control that has focus, not to the reader. */
const ownKeys =
  "input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=menu], [role=listbox], [role=tablist], [role=radiogroup], [role=slider], [role=dialog]:not([data-study-selection-menu]), [data-slot=model-picker-content]";

/**
 * "You left off here": a quiet bookmark line before the line the reader left
 * at. It holds no text of its own (the words are drawn by CSS), so offsets
 * read from the article's text still match the document's.
 */
function LeftOffMarker({ label }: { label: string }) {
  return (
    <span
      data-label={label}
      contentEditable={false}
      className="my-3 flex items-center gap-2 font-sans text-xs leading-4 text-muted-foreground select-none before:content-[attr(data-label)]"
    >
      <Icon icon={Bookmark02Icon} size={14} className="order-first shrink-0" />
      <span aria-hidden className="order-last h-px flex-1 bg-border" />
    </span>
  );
}

function highlighted(
  text: string,
  highlights: Highlight[],
  focus?: { offset: number; length: number },
  leftOff?: { at: number; label: string },
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
    // A transcript's `[mm:ss]` at the start of the line is drawn as a chip, same text.
    const markerStart = start;
    const markerEnd = start + timestampEnd(line);
    const inline = (from: number, to: number) =>
      withTimestampChip(text, from, to, markerStart, markerEnd, direction);
    let at = start;
    const content: ReactNode[] = [];
    for (; rangeIndex < ranges.length; rangeIndex++) {
      const range = ranges[rangeIndex];
      if (range.offset >= end) break;
      const from = Math.max(at, range.offset);
      const to = Math.min(end, range.end);
      if (from > at) content.push(inline(at, from));
      content.push(
        <mark
          id={range.offset >= start ? range.id : undefined}
          key={range.id}
          className={cn("rounded-[0.2em]", highlightColors[range.color])}
        >
          {inline(from, to)}
        </mark>,
      );
      at = to;
      if (range.end > end) break;
    }
    if (at < end) content.push(inline(at, end));
    const lineOffset = start;
    start = end;
    const block = (
      <span key={lineOffset} dir={direction} className="block">
        {content}
      </span>
    );
    return leftOff?.at === lineOffset ? [<LeftOffMarker key="left-off" label={leftOff.label} />, block] : block;
  });
}

/** The box a range takes on screen, or nothing when it is no longer in the page. */
function rangeRect(range: Range | null | undefined) {
  if (!range || range.collapsed || !range.startContainer.isConnected) return null;
  const rect = range.getBoundingClientRect();
  return rect.width || rect.height ? rect : null;
}

export function StudyReader({
  book,
  scanDraft,
  viewport,
  viewportRef,
  vaultId,
  requestedPage,
  reference,
  focusedHighlight,
  focusedRange,
  focusedVisual,
  highlights,
  words,
  tutor,
  conversations,
  tutorPane,
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
  reviewHighlights,
  reviewWords,
  notebookTitle,
  setupModel,
}: {
  book: StudyBook;
  scanDraft?: StudyOcrDraft;
  viewport: HTMLDivElement | null;
  viewportRef: Ref<HTMLDivElement>;
  vaultId: string;
  requestedPage?: number;
  reference: boolean;
  focusedHighlight?: string;
  focusedRange?: { offset: number; length: number; revision?: number };
  focusedVisual?: StudyVisualOrigin;
  highlights: Highlight[];
  words: StudyWord[];
  tutor?: ReaderTutor;
  /** This document's earlier conversations, for Ask's History. */
  conversations: ReaderConversations;
  tutorPane: RefObject<HTMLElement | null>;
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
  startImageChat: (section: number, capture: StudyImageCapture) => Promise<boolean>;
  openingTutor: boolean;
  layoutCheckpoint: RefObject<(() => void) | null>;
  focused: boolean;
  toggleFocus: () => void;
  back: () => void;
  reviewHighlights: () => void;
  reviewWords: (cardIds: string[]) => void;
  /** The title of the book's notebook, for the delete and remove-progress questions. */
  notebookTitle?: string;
  /** Opens Settings → AI providers, the fix wherever a model is missing. */
  setupModel?: () => void;
}) {
  const [removal, setRemoval] = useState<StudyDocumentRemoval | null>(null);
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
  const { t, i18n } = useTranslation("home");
  const rtl = i18n.dir() === "rtl";
  const focusLabel = t(focused ? "study.reader.exitFullscreen" : "study.reader.fullscreen");
  const settings = useSettings();
  const translateTo = settings?.study?.translateTo ?? defaultTranslationLanguage(navigator.language);
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
  const root = useRef<HTMLElement>(null);
  const textBody = useRef<HTMLElement>(null);
  const passageNotice = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const panelElement = useRef<HTMLElement>(null);
  const contentsElement = useRef<HTMLElement>(null);
  const contentsTrigger = useRef<HTMLButtonElement>(null);
  const companionToggle = useRef<HTMLButtonElement>(null);
  const selectionMenu = useRef<SelectionMenuHandle>(null);
  const anchorRange = useRef<Range | null>(null);
  const lastPointer = useRef("mouse");
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selectionByTouch, setSelectionByTouch] = useState(false);
  const [draftSource, setDraftSource] = useState<FlashcardSource | null>(null);
  const [visualAction, setVisualAction] = useState<{
    action: "card" | "discuss";
    capture: StudyImageCapture;
    section: number;
  }>();
  const [color, setColor] = useState<StudyHighlightColor>("yellow");
  const [editingSection, setEditingSection] = useState<number>();
  const [ocrMode, setOcrMode] = useState<"page" | "batch">();
  const [batchDraft, setBatchDraft] = useState<StudyOcrDraft>();
  const [openingScanReview, setOpeningScanReview] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const tutorShown = tutor?.visible ? tutor.thread.id : undefined;
  const layoutMode = useReaderCompanionLayout();
  const [companion, setCompanion] = useState<ReaderCompanionTab | null>(() =>
    tutorShown || (layoutMode === "column" && readCompanionPreference() !== "closed") ? "ask" : null,
  );
  const [contents, setContents] = useState<ReaderContentsTab | null>(null);
  const [chatQuote, setChatQuote] = useState<ReaderQuote>();
  const [chatSeed, setChatSeed] = useState<ReaderChatSeed>();
  const [shownTutor, setShownTutor] = useState(tutorShown);
  // Set while Ask goes back from a conversation to the list, so the companion stays open.
  const [listingConversations, setListingConversations] = useState(false);
  if (shownTutor !== tutorShown) {
    setShownTutor(tutorShown);
    if (tutorShown) setCompanion("ask");
    else if (companion === "ask" && shownTutor && !listingConversations) setCompanion(null);
    if (listingConversations) setListingConversations(false);
  }
  // The first-open strip, once per new document, and where "You left off here" goes: both as the reader was opened.
  const [firstOpen] = useState(() =>
    firstOpenStrip(readFirstOpen(book.id), book.lastReadAt !== undefined || book.readingPlace !== undefined),
  );
  const [strip, setStrip] = useState(firstOpen.show);
  const [openedPlace] = useState(book.readingPlace);
  const [within, setWithin] = useState(0);
  const appearance = { ...defaultStudyReadingAppearance, ...book.readingAppearance };
  const { textSize: font, pdfZoom: zoom, epubTheme } = appearance;
  const appearanceCheckpoint = useRef<StudyReadingPlace | undefined>(undefined);
  const [surfaceChoice, setSurfaceChoice] = useState<{ visit: string; surface: "text" | "layout" }>();
  const [savingSurface, setSavingSurface] = useState(false);
  const previousPlace = book.readingPlace;
  const savedSurface = previousPlace && book.sections[previousPlace.section]?.text.trim()
    ? previousPlace.surface
    : undefined;
  const showLayout = needsOriginal || (
    (surfaceChoice?.visit === location.key ? surfaceChoice.surface : undefined) ??
      (focusedVisual ? "layout" : undefined) ??
      book.preferredReadingSurface ?? savedSurface ?? (section.ocrLanguages ? "layout" : undefined)
  ) === "layout";
  const [readingSurface, setReadingSurface] = useState<{ section: number; root: HTMLElement | null }>();
  const viewPdf = showLayout && book.format === "pdf";
  const viewEpub = showLayout && book.format === "epub";
  const showingOriginal = Boolean((viewPdf || viewEpub) && fileId);
  const canToggleLayout = !!fileId && book.format !== "text" && !needsOriginal;
  const layoutLabel = book.format === "pdf"
    ? t(showLayout ? "study.reader.hideOriginalPage" : "study.reader.showOriginalPage")
    : t(showLayout ? "study.reader.hideBookLayout" : "study.reader.showBookLayout");
  const layout =
    showingOriginal && readingSurface?.section === index ? readingSurface.root : undefined;
  const loadingLayout = showingOriginal && layout === undefined;
  const [originalFile, setOriginalFile] = useState<{ url: string; mime: string }>();
  const started = useRef(0);
  const [readingSessionId] = useState(studyId);
  const latestInteraction = useRef(0);
  const { restoredLayout, captureLayout, prepareReflow } = useStudyReadingPlace({
    book,
    section: index,
    revision,
    visit: location.key,
    layoutKey: `${showingOriginal}:${font}:${viewPdf ? zoom : ""}`,
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
  const selectedMark = selection
    ? pageHighlights.find(
        ({ offset, quote }) =>
          offset <= selection.offset && offset + quote.length >= selection.offset + selection.text.length,
      )
    : undefined;
  const pageNoun = book.format === "pdf" ? "page" : "chapter";
  const progress = studyBookProgress(book, index, within);
  const percent = new Intl.NumberFormat(i18n.language, { style: "percent" }).format(
    progress < 1 ? Math.min(0.99, progress) : 1,
  );
  const showsTitle = !showingOriginal && book.format !== "pdf" &&
    !section.text.trimStart().startsWith(section.title.trim());
  const companionCovers = companion !== null && layoutMode !== "column";
  const part = readerPart(book, index);
  const partName = usePartName(part);
  const practice = useReaderPractice(book, index, vaultId);
  const companionId = `reader-companion-${book.id}`;
  const contentsId = `reader-contents-${book.id}`;
  const leftOffAt = !visitingPassage && openedPlace?.section === index && openedPlace.surface === "text" &&
      openedPlace.anchor && markdown === undefined && !showingOriginal && hasPageText
    ? leftOffLineStart(section.text, locateStudyMark(book, { ...openedPlace.anchor, section: index }))
    : undefined;

  useEffect(() => {
    if (firstOpen.remember) rememberFirstOpen(book.id, firstOpen.remember);
  }, [book.id, firstOpen]);

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
      const area = layout.parentElement?.querySelector("[data-study-image-region]");
      if (area) {
        area.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        return;
      }
      const bounds = layout.getBoundingClientRect();
      const top = bounds.top + bounds.height * (pageTop / 10_000);
      viewport.scrollBy({
        top: top - viewport.getBoundingClientRect().top - 32,
        behavior: "instant",
      });
    } else if (layout && visualKind === "epub" && figure !== undefined) {
      const picture = layout.querySelector<HTMLImageElement>(`img[data-study-figure="${figure}"]`);
      if (!picture) return;
      const area = picture.parentElement?.querySelector("[data-study-image-region]");
      const center = () => (area ?? picture).scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
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

  // How far down this section the reader is, for the progress line.
  useEffect(() => {
    if (!viewport) return;
    let next = 0;
    const read = () => {
      const room = viewport.scrollHeight - viewport.clientHeight;
      setWithin(room > 1 ? viewport.scrollTop / room : 1);
    };
    const schedule = () => {
      cancelAnimationFrame(next);
      next = requestAnimationFrame(read);
    };
    schedule();
    viewport.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    return () => {
      cancelAnimationFrame(next);
      viewport.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [viewport, index]);

  // The selected passage stays marked while the menu has focus.
  useEffect(() => {
    const range = anchorRange.current;
    if (!selection || !range || !globalThis.CSS?.highlights) return;
    CSS.highlights.set("study-selection", new Highlight(range));
    return () => {
      CSS.highlights.delete("study-selection");
    };
  }, [selection]);

  const dismissSelection = useEffectEvent(() => closeSelection(false));
  useEffect(() => {
    if (!selection) return;
    function down(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || selectionMenu.current?.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest('[role="menu"], [role="listbox"], [data-sonner-toaster], [data-slot="model-picker-content"]')
      )
        return;
      dismissSelection();
    }
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [selection]);

  // A touch selection ends with the handles, not a mouseup: read it once it settles.
  const captureSettled = useEffectEvent(() => {
    const native = window.getSelection();
    const node = native?.anchorNode;
    if (!native || native.isCollapsed || !node) return;
    if (layout?.contains(node)) captureRendered(layout);
    else if (textBody.current?.contains(node)) capture();
  });
  useEffect(() => {
    let timer = 0;
    function changed() {
      if (lastPointer.current !== "touch") return;
      window.clearTimeout(timer);
      timer = window.setTimeout(captureSettled, 450);
    }
    document.addEventListener("selectionchange", changed);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", changed);
    };
  }, []);

  const keyOnPage = useEffectEvent((event: KeyboardEvent) => {
    if (event.target === document.body || event.target === document.documentElement) readerKey(event);
  });
  useEffect(() => {
    document.addEventListener("keydown", keyOnPage);
    return () => document.removeEventListener("keydown", keyOnPage);
  }, []);

  function clearNativeSelection() {
    const native = window.getSelection();
    const node = native?.anchorNode;
    if (node && root.current?.contains(node)) native.removeAllRanges();
  }

  function closeSelection(restoreFocus = true) {
    const hadFocus = restoreFocus && selectionMenu.current?.contains(document.activeElement);
    setSelection(null);
    anchorRange.current = null;
    if (restoreFocus) clearNativeSelection();
    if (hadFocus) (textBody.current ?? viewport)?.focus({ preventScroll: true });
  }

  function clearSelection() {
    setSelection(null);
    anchorRange.current = null;
  }

  function go(page: number) {
    if (page < 0 || page >= book.sections.length) return;
    clearSelection();
    setDraftSource(null);
    setVisualAction(undefined);
    setEditingSection(undefined);
    setOcrMode(undefined);
    openPage(page);
  }

  function openSearch() {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInput.current?.select();
      searchInput.current?.focus();
    });
  }

  /** Opens the companion; Ask shows a hidden tutor session again, unless a passage is asked about. */
  function showCompanion(next: ReaderCompanionTab, { showTutor = true }: { showTutor?: boolean } = {}) {
    setCompanion(next);
    if (layoutMode !== "column") setContents(null);
    else rememberCompanionPreference("open");
    if (showTutor && next === "ask" && tutor && !tutor.visible) tutor.show();
  }

  /** Closes the companion; over the text, focus goes back to the button that opens it. */
  function closeCompanion() {
    setCompanion(null);
    if (layoutMode === "column") rememberCompanionPreference("closed");
    if (tutor?.visible) tutor.hide();
    if (layoutMode !== "column") requestAnimationFrame(() => companionToggle.current?.focus({ preventScroll: true }));
  }

  function showContents(next: ReaderContentsTab) {
    setContents(next);
    if (layoutMode !== "column") setCompanion(null);
  }

  function closeContents(restoreFocus = true) {
    setContents(null);
    if (restoreFocus) requestAnimationFrame(() => contentsTrigger.current?.focus({ preventScroll: true }));
  }

  function readerKey(event: KeyboardEvent | ReactKeyboardEvent) {
    if (event.defaultPrevented || ("isComposing" in event && event.isComposing)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (
      hasBookText && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey &&
      event.key.toLowerCase() === "f"
    ) {
      event.preventDefault();
      openSearch();
      return;
    }
    if (event.key === "Escape") {
      if (selection) {
        event.preventDefault();
        closeSelection();
      } else if (searchOpen && target?.closest("[data-study-reader-search]")) {
        event.preventDefault();
        setSearchOpen(false);
        (textBody.current ?? viewport)?.focus({ preventScroll: true });
      } else if (
        target?.closest(escapeOwners) ||
        // Escape in a field keeps what was typed: it doesn't close the panel around it.
        target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
      ) {
        return;
      } else if (contents) {
        event.preventDefault();
        closeContents();
      } else if (companion && layoutMode !== "column") {
        // At full width the companion is a column of the page and stays; over the text it closes.
        event.preventDefault();
        closeCompanion();
      }
      return;
    }
    if (
      selection && (
        (event.key === "F10" && event.altKey) ||
        (event.key === "Tab" && !event.shiftKey && !target?.closest(ownKeys))
      ) &&
      !selectionMenu.current?.contains(target)
    ) {
      event.preventDefault();
      selectionMenu.current?.focus();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || target?.closest(ownKeys)) return;
    if (target && (panelElement.current?.contains(target) || contentsElement.current?.contains(target))) return;
    if (selection) {
      const key = event.key.toLowerCase();
      if (key === "h") void saveHighlight(color);
      else if (key === "t") selectionMenu.current?.run("translate");
      else if (key === "w") selectionMenu.current?.run("word");
      else if (key === "n") selectionMenu.current?.run("note");
      else if (key === "a") ask();
      else return;
      event.preventDefault();
      return;
    }
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !event.shiftKey) {
      const forward = (event.key === "ArrowRight") !== rtl;
      const next = index + (forward ? 1 : -1);
      if (next < 0 || next >= book.sections.length) return;
      event.preventDefault();
      go(next);
    }
  }

  async function openScanReview() {
    if (!fileId || openingScanReview) return;
    setOpeningScanReview(true);
    try {
      setBatchDraft(await readStudyOcrDraft(book.id, fileId));
      setOcrMode("batch");
    } catch {
      toast.error(t("study.scan.openFailed"));
    } finally {
      setOpeningScanReview(false);
    }
  }

  function openVisualAction(capture: StudyImageCapture, action: "card" | "discuss") {
    clearSelection();
    setVisualAction({ action, capture, section: index });
  }

  async function saveVisualCard({ visual, ...content }: VisualFlashcard, section: number) {
    const card = await saveStudyVisualCard(book, section, visual, {
      ...content,
      notebookId: book.notebookId,
      vaultId,
      tags: [book.title],
    });
    setVisualAction(undefined);
    toast.success(t("study.visualCard.saved"), {
      action: {
        label: t("study.visualCard.review"),
        onClick: () => navigate(studyHref("review", { card: card.id, vault: vaultId })),
      },
    });
  }

  async function toggleLayout(visible: boolean, checkpoint?: StudyReadingPlace) {
    if (savingSurface || visible === showLayout) return;
    const preferredReadingSurface = visible ? "layout" : "text";
    const cancel = prepareReflow(checkpoint, preferredReadingSurface);
    setSavingSurface(true);
    try {
      await updateStudyBook(book.id, { preferredReadingSurface });
      if (!visible) setReadingSurface(undefined);
      setSurfaceChoice({ visit: location.key, surface: preferredReadingSurface });
    } catch (error) {
      cancel();
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingSurface(false);
    }
  }

  async function changeAppearance(change: Partial<StudyReadingAppearance>) {
    const changesSize =
      (change.textSize ?? font) !== font ||
      (change.font ?? appearance.font) !== appearance.font ||
      (viewPdf && (change.pdfZoom ?? zoom) !== zoom);
    const cancel = changesSize ? prepareReflow(appearanceCheckpoint.current) : undefined;
    try {
      await updateStudyBook(book.id, { readingAppearance: change });
    } catch (error) {
      cancel?.();
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  function chooseTranslateTo(code: string) {
    void updateSettings((saved) => {
      saved.study = { ...saved.study, translateTo: code };
    }).catch((error: Error) => toast.error(error.message));
  }

  function selectPassage(selected: Omit<Selection, "revision">, range?: Range) {
    latestInteraction.current = Date.now();
    if (
      selection && selection.offset === selected.offset && selection.text === selected.text &&
      selection.revision === revision
    )
      return;
    const live = window.getSelection();
    anchorRange.current = range ?? (live?.rangeCount && !live.isCollapsed ? live.getRangeAt(0).cloneRange() : null);
    setSelectionByTouch(lastPointer.current === "touch");
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

  function captureRendered(surface: HTMLElement) {
    if (!hasPageText) return;
    const selected = renderedSelection(surface, section.text);
    if (selected === undefined) return;
    if (selected === null) {
      toast.error(t("study.selection.useExtractedText"));
      return;
    }
    selectPassage(selected);
  }

  /** A click on a saved highlight opens the menu for it. */
  function openHighlightAt(surface: HTMLElement | null | undefined, event: ReactMouseEvent) {
    if (!surface || !pageHighlights.length) return;
    if (event.target instanceof Element && event.target.closest("button, a, input, textarea, [role=button]")) return;
    const native = window.getSelection();
    if (native && !native.isCollapsed) return;
    for (const item of pageHighlights) {
      const range = renderedStudyRange(surface, section.text, item);
      const hit = range && Array.from(range.getClientRects()).some(
        (rect) => event.clientX >= rect.left && event.clientX <= rect.right &&
          event.clientY >= rect.top && event.clientY <= rect.bottom,
      );
      if (hit && range) {
        selectPassage({ text: item.quote, offset: item.offset }, range);
        return;
      }
    }
  }

  function selectionAnchor() {
    const live = rangeRect(anchorRange.current);
    if (live || !selection) return live;
    const surface = layout ?? textBody.current;
    const range = surface && renderedStudyRange(surface, section.text, { offset: selection.offset, quote: selection.text });
    anchorRange.current = range ?? null;
    return rangeRect(range);
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

  function makeNote(selected: Selection, body = selected.text) {
    void saveStudyNote({
      title: `${book.title} · ${section.title}`,
      body,
      origin: sourceOf(selected),
      notebookId: book.notebookId,
    })
      .then((note) =>
        toast.success(t("study.selection.savedToNotes"), {
          action: {
            label: t("study.selection.openNote"),
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
      toast.info(t("study.selection.alreadyBookmarked"));
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
      .then(() => toast.success(t("study.selection.bookmarked")))
      .catch((error: Error) => toast.error(error.message));
  }

  function newHighlight(selected: Selection, choice: StudyHighlightColor, note = ""): Highlight {
    return {
      id: studyId(),
      kind: "highlight",
      bookId: book.id,
      notebookId: book.notebookId,
      section: index,
      quote: selected.text,
      offset: selected.offset,
      revision: selected.revision,
      color: choice,
      note,
      updatedAt: Date.now(),
      schedule: freshSchedule(),
    };
  }

  async function saveHighlight(choice: StudyHighlightColor) {
    const selected = selection;
    if (!selected) return;
    setColor(choice);
    closeSelection();
    try {
      if (selectedMark) {
        if (selectedMark.color === choice) return;
        await updateStudyReviewItem({
          kind: "highlight",
          id: selectedMark.id,
          change: { note: selectedMark.note, cue: selectedMark.cue, color: choice },
          updatedAt: Date.now(),
        });
        return;
      }
      const row = newHighlight(selected, choice);
      await putStudyRecords(row);
      toast.success(t("study.selection.highlightSaved"), {
        action: { label: t("study.selection.undo"), onClick: () => void removeStudyRecord(row.id) },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function removeHighlight() {
    const original = highlights.find(({ id }) => id === selectedMark?.id);
    closeSelection();
    if (!original) return;
    try {
      await removeStudyRecord(original.id);
      toast.success(t("study.selection.highlightRemoved"), {
        action: {
          label: t("study.selection.undo"),
          onClick: () => void putStudyRecords({ ...original, updatedAt: Date.now() }),
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveSelectionNote(note: string) {
    const selected = selection;
    if (!selected) return;
    if (selectedMark) {
      const saved = await updateStudyReviewItem({
        kind: "highlight",
        id: selectedMark.id,
        change: { note, cue: selectedMark.cue, color: selectedMark.color },
        updatedAt: Date.now(),
      });
      if (!saved) throw new Error(t("study.recall.editUnavailable"));
    } else if (note) {
      await putStudyRecords(newHighlight(selected, color, note));
    }
    toast.success(t("study.selection.noteSaved"));
  }

  /** Closes the tutor session in Ask and goes back to the document's chat, keeping the companion open. */
  function leaveTutor() {
    if (tutor?.visible) setListingConversations(true);
    conversations.leave();
  }

  /** Sends a passage to Ask in the companion: asked about next, or an explanation carried on. */
  function askInPanel(quote: ReaderQuote, explanation?: string) {
    if (explanation) setChatSeed({ id: crypto.randomUUID(), quote, explanation });
    else setChatQuote(quote);
    if (tutor) leaveTutor();
    showCompanion("ask", { showTutor: false });
  }

  function ask() {
    if (!selection) return;
    askInPanel({ text: selection.text, section: index + 1 });
    closeSelection(false);
  }

  /** Discussing opens Ask beside the page, which reads the rest of the book itself; Teach it back is a tutor session. */
  function discuss(what: "chapter" | "book" | "teach-back") {
    if (what === "teach-back") {
      startChat("chapter", index, undefined, "teach-back");
      return;
    }
    if (tutor) leaveTutor();
    showCompanion("ask", { showTutor: false });
  }

  const originalDownload = fileId && originalFile
    ? source?.fileName ?? `${book.title}.${book.format === "text" ? (originalFile.mime === "text/markdown" ? "md" : "txt") : book.format}`
    : undefined;
  const canScanPage = book.format === "pdf" && !!fileId && (!hasPageText || !!section.ocrLanguages) &&
    !scanDraft?.pages.some(({ section }) => section === index);
  const canScanBook = book.format === "pdf" && !!fileId && book.sections.length > 1 &&
    book.sections.some(({ text }) => !text.trim());
  // The edit rewrites the source's text too, so it needs the source.
  const canEditText = canEditStudyText(book) && source !== null;
  const bookmarked = book.bookmarks.includes(index);
  const searchKeys = [/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl", "F"];

  const notices = (
    <>
      {source === null ? (
        <p className="text-sm text-muted-foreground">{t("study.capture.sourceRemoved")}</p>
      ) : null}
      {visitingPassage ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <span>{t("study.reader.visiting")}</span>
          <Button size="sm" variant="ghost" onClick={resume}>{t("study.reader.resume")}</Button>
        </div>
      ) : null}
      {missingPassage ? (
        <div ref={passageNotice} role="status" className="rounded-xl bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {t("study.reader.passageChanged")}{" "}
          <button
            type="button"
            className="cursor-pointer underline underline-offset-4"
            hidden={!hasBookText}
            onClick={openSearch}
          >
            {t("study.reader.search")}
          </button>
        </div>
      ) : null}
      {selectedHighlight && (missingPassage || selectedHighlight.note.trim()) ? (
        <div className="space-y-3 rounded-xl border-s-2 bg-muted/40 px-3 py-2.5 text-sm">
          {missingPassage ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground">{t("study.highlights.savedExcerpt")}</p>
              <blockquote className="mt-1 font-serif">
                <StudyText text={selectedHighlight.quote} className="wrap-break-word" />
              </blockquote>
            </div>
          ) : null}
          {selectedHighlight.note.trim() ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground">{t("study.highlights.annotation")}</p>
              <DirectionalText
                multiline
                text={selectedHighlight.note}
                className="mt-1 wrap-break-word whitespace-pre-wrap"
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );

  return (
    <section
      ref={root}
      aria-label={book.title}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-card"
      onKeyDown={(event) => {
        if (event.target instanceof Node && event.currentTarget.contains(event.target)) readerKey(event);
      }}
      onPointerDown={(event) => {
        lastPointer.current = event.pointerType;
      }}
    >
      <header
        data-window-bar={focused ? "" : undefined}
        className="flex min-h-14 shrink-0 items-center gap-1 border-b px-2 sm:px-3"
      >
        <ReaderTip label={t("study.reader.back")} side="bottom">
          <Button size="icon-sm" variant="ghost" aria-label={t("study.reader.back")} onClick={back}>
            <Icon icon={ArrowLeft01Icon} size={18} className="rtl:rotate-180" />
          </Button>
        </ReaderTip>
        <div className="min-w-0 flex-1 px-1 leading-tight">
          {notebookTitle ? (
            <nav aria-label={t("study.readerCompanion.breadcrumb")} className="hidden sm:block">
              <Link
                to={routes.notebook(book.notebookId)}
                state={returnState}
                className="block truncate text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:underline"
                dir="auto"
              >
                {notebookTitle}
              </Link>
            </nav>
          ) : null}
          <h1 className="truncate text-[0.8125rem] font-medium" title={book.title} dir={textDirection(book.title)}>
            {book.title}
          </h1>
          <p className="truncate text-xs text-muted-foreground sm:hidden" dir="auto">{section.title}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <span className="me-1 hidden text-xs text-muted-foreground tabular-nums md:block">
            {t(book.format === "pdf" ? "study.reader.pageOf" : "study.reader.sectionOf", {
              current: index + 1,
              count: book.sections.length,
            })}
            {" · "}
            {percent}
          </span>
          {hasBookText ? (
            <ReaderTip label={t("study.reader.search")} keys={searchKeys} side="bottom">
              <Button
                size="icon-sm"
                variant={searchOpen ? "secondary" : "ghost"}
                aria-label={t("study.reader.search")}
                aria-expanded={searchOpen}
                onClick={() => (searchOpen ? setSearchOpen(false) : openSearch())}
              >
                <Icon icon={Search01Icon} size={17} />
              </Button>
            </ReaderTip>
          ) : null}
          <Button
            ref={contentsTrigger}
            size="sm"
            variant="ghost"
            className={cn("gap-1.5 px-2", contents && "bg-muted text-foreground")}
            aria-label={t("study.readerCompanion.contents.label")}
            aria-expanded={contents !== null}
            aria-controls={contentsId}
            onClick={() => (contents ? closeContents() : showContents("outline"))}
          >
            <Icon icon={LeftToRightListBulletIcon} size={17} className="rtl:-scale-x-100" />
            <span className="hidden sm:inline">{t("study.readerCompanion.contents.label")}</span>
          </Button>
          <StudyReaderSettings
            appearance={appearance}
            original={showingOriginal && book.format !== "text" ? book.format : undefined}
            layoutToggle={canToggleLayout ? {
              label: layoutLabel,
              disabled: savingSurface,
              toggle: () => void toggleLayout(!showLayout, appearanceCheckpoint.current),
            } : undefined}
            translateTo={translateTo}
            onTranslateTo={chooseTranslateTo}
            onOpen={() => { appearanceCheckpoint.current = captureLayout(); }}
            onChange={(change) => void changeAppearance(change)}
          />
          <Menu>
            <Menu.Trigger
              render={<Button size="icon-sm" variant="ghost" aria-label={t("study.reader.more")} title={t("study.reader.more")} />}
            >
              <Icon icon={MoreHorizontalIcon} size={18} />
            </Menu.Trigger>
            <Menu.Content align="end">
              <Menu.Item
                onClick={() =>
                  void updateStudyBook(book.id, {
                    bookmarks: bookmarked ? book.bookmarks.filter((at) => at !== index) : [...book.bookmarks, index],
                  })
                }
              >
                {t(bookmarked ? `study.reader.removePageBookmark.${pageNoun}` : `study.reader.bookmarkPage.${pageNoun}`)}
              </Menu.Item>
              {visitingPassage ? <Menu.Item onClick={resume}>{t("study.reader.resume")}</Menu.Item> : null}
              <Menu.Separator />
              <Menu.Item disabled={openingTutor || !hasPageText} onClick={() => discuss("chapter")}>
                {t(`study.reader.discuss.${pageNoun}`)}
              </Menu.Item>
              <Menu.Item disabled={openingTutor || !hasBookText} onClick={() => discuss("book")}>
                {t("study.reader.discuss.book")}
              </Menu.Item>
              <Menu.Item disabled={openingTutor || !hasPageText} onClick={() => discuss("teach-back")}>
                {t("study.reader.teachBack")}
              </Menu.Item>
              <Menu.Item disabled={!hasPageText} onClick={() => draftCards(section.text)}>
                {t("study.capture.cardsFromSection")}
              </Menu.Item>
              {canScanPage || canScanBook || canEditText || canToggleLayout || originalDownload ? <Menu.Separator /> : null}
              {canScanPage ? (
                <Menu.Item onClick={() => setOcrMode("page")}>
                  {t(section.ocrLanguages ? "study.scan.edit" : "study.scan.title")}
                </Menu.Item>
              ) : null}
              {canScanBook ? (
                <Menu.Item disabled={openingScanReview} onClick={() => void openScanReview()}>
                  {t(scanDraft?.pages.length ? "study.scan.resume" : "study.scan.batch")}
                </Menu.Item>
              ) : null}
              {canEditText ? (
                <Menu.Item disabled={editingSection === index} onClick={() => setEditingSection(index)}>
                  {t("study.documentEditor.edit")}
                </Menu.Item>
              ) : null}
              {canToggleLayout ? (
                <Menu.Item disabled={savingSurface} onClick={() => void toggleLayout(!showLayout)}>
                  {layoutLabel}
                </Menu.Item>
              ) : null}
              {originalDownload && originalFile ? (
                <Menu.Item render={<a href={originalFile.url} download={originalDownload} />}>
                  {t("study.reader.downloadOriginal")}
                </Menu.Item>
              ) : null}
              <Menu.Separator />
              <Menu.Item render={<Link to={routes.notebook(book.notebookId)} state={returnState} />}>
                {t("study.reader.openNotebook")}
              </Menu.Item>
              <Menu.Item render={<Link to={studyNotesHref(book.notebookId)} state={returnState} />}>
                {t("study.reader.notes")}
              </Menu.Item>
              <Menu.Item render={<Link to={studyHref("cards", { book: book.id })} state={returnState} />}>
                {t("study.reader.flashcards")}
              </Menu.Item>
              <Menu.Item render={<Link to={studyHref("highlights", { book: book.id })} state={returnState} />}>
                {t("study.reader.allHighlights")}
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item onClick={toggleFocus}>{focusLabel}</Menu.Item>
              <Menu.Separator />
              <Menu.Item onClick={() => setRemoval({ kind: "progress", book })}>
                {t("study.library.removeProgress")}
              </Menu.Item>
              <Menu.Item
                variant="destructive"
                onClick={() =>
                  setRemoval({ kind: "delete", document: { notebookId: book.notebookId, sourceId: book.sourceId } })
                }
              >
                {t("study.library.delete")}
              </Menu.Item>
            </Menu.Content>
          </Menu>
          <span aria-hidden className="mx-1 hidden h-5 w-px bg-border sm:block" />
          {/* The one filled button. While the Practise tab is open it steps back, and Start is filled there. */}
          <Button
            variant={companion === "practise" ? "outline" : "default"}
            className="h-auto min-h-8 gap-2 rounded-xl py-1 ps-2.5 pe-3 sm:min-h-10 sm:ps-3 sm:pe-4"
            aria-describedby={`${companionId}-practise-reason`}
            onClick={() => showCompanion("practise")}
          >
            <Icon icon={TeachingIcon} size={16} className="shrink-0" />
            <span className="flex flex-col items-start text-start leading-4">
              <span className="sr-only text-[0.8125rem] font-semibold sm:not-sr-only">{t("study.readerCompanion.practiseThis")}</span>
              <span
                id={`${companionId}-practise-reason`}
                className={cn(
                  "hidden text-xs font-normal whitespace-nowrap lg:block",
                  companion === "practise" ? "text-muted-foreground" : "text-primary-foreground/72",
                )}
              >
                {t(`study.readerCompanion.practiseReason.${practice.exercise}`, { part: partName.inline })}
              </span>
            </span>
          </Button>
          <ReaderTip label={t("study.readerCompanion.toggle")} side="bottom">
            <Button
              ref={companionToggle}
              size="icon-sm"
              variant="ghost"
              className={cn(companion && "bg-muted text-foreground")}
              aria-label={t("study.readerCompanion.toggle")}
              aria-expanded={companion !== null}
              aria-controls={companionId}
              onClick={() => (companion ? closeCompanion() : showCompanion("ask"))}
            >
              <Icon icon={SidebarRightIcon} size={18} className="rtl:-scale-x-100" />
            </Button>
          </ReaderTip>
        </div>
      </header>
      {strip ? (
        <Alert variant="banner" className="shrink-0 [&_[data-slot=alert-body]]:bg-background">
          <Alert.Icon>
            <Icon icon={InformationCircleIcon} size={16} className="text-muted-foreground" />
          </Alert.Icon>
          <Alert.Description>{t("study.readerCompanion.firstOpen.body")}</Alert.Description>
          <Alert.Actions>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setStrip(false);
                rememberFirstOpen(book.id, "done");
              }}
            >
              {t("study.readerCompanion.firstOpen.dismiss")}
            </Button>
          </Alert.Actions>
        </Alert>
      ) : null}
      <StudyDocumentRemovalDialog
        removal={removal}
        notebook={notebookTitle}
        onClose={() => setRemoval(null)}
        onDone={back}
      />
      {searchOpen && hasBookText ? (
        <div data-study-reader-search="" className="shrink-0 border-b px-3 py-2">
          <div className="mx-auto max-w-3xl">
            <StudyDocumentSearch
              input={searchInput}
              sections={book.sections}
              active={focus && { section: index, ...focus }}
              open={({ section, offset, length }) => {
                clearSelection();
                setVisualAction(undefined);
                setEditingSection(undefined);
                setOcrMode(undefined);
                openPassage(section, { offset, length });
              }}
              study={({ offset, length }) => {
                selectPassage({ text: section.text.slice(offset, offset + length), offset }, undefined);
              }}
            />
          </div>
        </div>
      ) : null}
      <div className="relative flex min-h-0 flex-1">
        <div
          ref={setFrame}
          className="relative flex min-h-0 min-w-0 flex-1 flex-col"
          inert={companionCovers || (contents !== null && layoutMode === "sheet")}
          onPointerMove={() => {
            latestInteraction.current = Date.now();
          }}
        >
          <ScrollArea className="min-h-0 flex-1" viewportRef={viewportRef}>
            <div className="px-5 pt-8 pb-28 sm:px-8 sm:pt-12">
              <div className="mx-auto max-w-[44rem] space-y-3 empty:hidden">{notices}</div>
              {editingSection === index && canEditText ? (
                <div className="mx-auto mt-4 max-w-[44rem]">
                  <StudyDocumentEdits
                    key={index}
                    book={book}
                    section={index}
                    vaultId={vaultId}
                    open
                    showTrigger={false}
                    onOpenChange={(open) => setEditingSection(open ? index : undefined)}
                    onSave={clearSelection}
                  />
                </div>
              ) : null}
              {showsTitle ? (
                <header className={cn("mx-auto mt-6 mb-8 max-w-[44rem] first:mt-0", appearance.font === "sans" ? "font-sans" : "font-serif")}>
                  {book.format !== "pdf" && book.sections.length > 1 ? (
                    <p className="mb-2 font-sans text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                      {t("study.reader.sectionNumber", { number: index + 1 })}
                    </p>
                  ) : null}
                  <h1 className="text-[1.75rem] leading-tight font-medium text-balance wrap-break-word" dir="auto">
                    {section.title}
                  </h1>
                </header>
              ) : null}
              {showingOriginal ? (
                <div className="mx-auto max-w-5xl" onClick={(event) => openHighlightAt(layout, event)}>
                  {viewPdf && fileId ? (
                    <StudyPdfPage
                      key={index}
                      fileId={fileId}
                      page={index}
                      sectionText={section.text}
                      marks={renderedMarks}
                      zoom={zoom}
                      layoutVisit={location.key}
                      focusCrop={focusedVisual?.kind === "pdf" ? focusedVisual.crop : undefined}
                      onSelect={captureRendered}
                      onReadingSurface={setReadingSurface}
                      onVisual={(capture) => openVisualAction(capture, "card")}
                      onDiscuss={(capture) => void startImageChat(index, capture)}
                      onDiscussArea={(capture) => openVisualAction(capture, "discuss")}
                    />
                  ) : null}
                  {viewEpub && fileId ? (
                    <StudyEpubChapter
                      key={index}
                      fileId={fileId}
                      section={section}
                      index={index}
                      sections={book.sections}
                      marks={renderedMarks}
                      font={font}
                      theme={epubTheme}
                      focus={focusedVisual?.kind === "epub" ? focusedVisual : undefined}
                      go={go}
                      onSelect={captureRendered}
                      onReadingSurface={setReadingSurface}
                      onVisual={(capture) => openVisualAction(capture, "card")}
                      onDiscuss={(capture) => void startImageChat(index, capture)}
                      onDiscussArea={(capture) => openVisualAction(capture, "discuss")}
                    />
                  ) : null}
                </div>
              ) : null}
              {section.ocrLanguages ? (
                <p className="mx-auto mt-6 max-w-[44rem] text-sm font-medium text-muted-foreground">{t("study.scan.recognized")}</p>
              ) : null}
              <p id={`${contentsId}-selection-hint`} className="sr-only">
                {t("study.readerCompanion.selectionHint")}
              </p>
              <article
                ref={textBody}
                tabIndex={0}
                aria-label={section.title}
                aria-keyshortcuts="Alt+F10"
                aria-describedby={`${contentsId}-selection-hint`}
                className={cn(
                  "mx-auto max-w-[44rem] leading-[1.8] wrap-break-word outline-none rounded-sm focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:ring-offset-8 focus-visible:ring-offset-card",
                  showingOriginal && "mt-8",
                  appearance.font === "sans" ? "font-sans" : "font-serif",
                  markdown === undefined ? "whitespace-pre-wrap" : "markdown study-math study-reading-text",
                )}
                style={{ fontSize: font }}
                onMouseUp={capture}
                onTouchEnd={capture}
                onKeyUp={capture}
                onClick={(event) => openHighlightAt(textBody.current, event)}
              >
                {markdown !== undefined ? (
                  <StudyMarkdown bare imageAltOnly math={formulaMode} onMathReady={onMathReady} text={markdown} />
                ) : hasPageText ? (
                  highlighted(
                    section.text,
                    pageHighlights,
                    focus,
                    leftOffAt === undefined ? undefined : { at: leftOffAt, label: t("study.readerCompanion.leftOff") },
                  )
                ) : (
                  <span className="font-sans text-base text-muted-foreground">{t("study.reader.noSelectableText")}</span>
                )}
              </article>
            </div>
          </ScrollArea>
          {selection && frame ? (
            <StudySelectionMenu
              key={`${selection.offset}:${selection.text.length}:${selection.revision}`}
              handle={selectionMenu}
              selection={selection}
              frame={frame}
              viewport={viewport}
              anchor={selectionAnchor}
              preferBelow={selectionByTouch}
              notebookId={book.notebookId}
              bookId={book.id}
              tags={[book.title]}
              sectionTitle={section.title}
              sectionText={section.text}
              origin={sourceOf(selection)}
              vaultId={vaultId}
              translateTo={translateTo}
              chooseTranslateTo={chooseTranslateTo}
              highlight={selectedMark}
              color={color}
              openingTutor={openingTutor}
              onHighlight={(choice) => void saveHighlight(choice)}
              onRemoveHighlight={() => void removeHighlight()}
              onSaveNote={saveSelectionNote}
              onAsk={ask}
              onTeachBack={() => {
                startChat("passage", index, selection, "teach-back");
                closeSelection();
              }}
              onDraftCards={(text) => {
                draftCards(text, selection);
                closeSelection();
              }}
              onBookmark={() => {
                bookmarkSelection(selection);
                closeSelection();
              }}
              onSaveToNotes={(body) => {
                makeNote(selection, body);
                if (body === undefined) closeSelection();
              }}
              onContinueExplain={(answer) => {
                askInPanel({ text: selection.text, section: index + 1 }, answer);
                closeSelection(false);
              }}
              onShowWords={() => {
                closeSelection(false);
                showContents("words");
              }}
              onViewCards={() => navigate(studyHref("cards", { book: book.id }), { state: returnState })}
              onClose={() => closeSelection()}
            />
          ) : null}
        </div>
        {contents ? (
          <StudyReaderContents
            id={contentsId}
            tab={contents}
            chooseTab={showContents}
            close={() => closeContents()}
            full={layoutMode === "sheet"}
            book={book}
            vaultId={vaultId}
            index={index}
            highlights={highlights}
            words={words}
            openingTutor={openingTutor}
            go={(at) => {
              closeContents(false);
              if (at !== index) go(at);
              (textBody.current ?? viewport)?.focus({ preventScroll: true });
            }}
            goToHighlight={(item) => {
              closeContents(false);
              navigate(originHref(studyHighlightOrigin(item), readerParams), { state: returnState });
            }}
            askHighlight={(item) => askInPanel({ text: item.quote, section: item.section + 1 })}
            reviewHighlights={reviewHighlights}
            reviewWords={reviewWords}
            panelRef={contentsElement}
          />
        ) : null}
        {companion && layoutMode === "overlay" ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            className="absolute inset-0 z-20 cursor-default bg-foreground/10 motion-safe:animate-in motion-safe:fade-in-0"
            onClick={closeCompanion}
          />
        ) : null}
        {companion ? (
          <StudyReaderCompanion
            id={companionId}
            tab={companion}
            chooseTab={showCompanion}
            close={closeCompanion}
            layout={layoutMode}
            book={book}
            vaultId={vaultId}
            index={index}
            part={part}
            notebookTitle={notebookTitle}
            tutor={tutor}
            conversations={{ ...conversations, leave: leaveTutor }}
            canDiscussPage={hasPageText}
            chatQuote={chatQuote}
            clearChatQuote={() => setChatQuote(undefined)}
            chatSeed={chatSeed}
            openSection={(at) => go(at - 1)}
            makeCards={() => draftCards(section.text)}
            setupModel={setupModel}
            panelRef={panelElement}
            tutorPane={tutorPane}
          />
        ) : null}
      </div>
      <footer className="flex h-12 shrink-0 items-center gap-3 border-t px-2 text-xs text-muted-foreground sm:px-3">
        <ReaderTip label={t("study.reader.previous")} keys={[rtl ? "→" : "←"]}>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("study.reader.previous")}
            disabled={index === 0}
            onClick={() => go(index - 1)}
          >
            <Icon icon={ArrowLeft01Icon} size={16} className="rtl:rotate-180" />
          </Button>
        </ReaderTip>
        <span className="min-w-9 shrink-0 tabular-nums">{percent}</span>
        <div
          role="progressbar"
          aria-label={t("study.reader.progress")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
        >
          <span
            className="absolute inset-y-0 start-0 rounded-full bg-foreground/60 transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <span className="shrink-0 tabular-nums">
          {t(book.format === "pdf" ? "study.reader.pageOf" : "study.reader.sectionOf", {
            current: index + 1,
            count: book.sections.length,
          })}
        </span>
        <ReaderTip label={t("study.reader.next")} keys={[rtl ? "←" : "→"]}>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("study.reader.next")}
            disabled={index === book.sections.length - 1}
            onClick={() => go(index + 1)}
          >
            <Icon icon={ArrowRight01Icon} size={16} className="rtl:rotate-180" />
          </Button>
        </ReaderTip>
      </footer>
      {ocrMode === "page" && fileId ? (
        <StudyPageOcr
          key={`${book.id}:${index}`}
          bookId={book.id}
          fileId={fileId}
          page={index}
          section={section}
          onClose={() => setOcrMode(undefined)}
          onSave={() => {
            if (needsOriginal) setSurfaceChoice({ visit: location.key, surface: "layout" });
            clearSelection();
            setOcrMode(undefined);
            toast.success(t("study.scan.saved"));
          }}
        />
      ) : null}
      {ocrMode === "batch" && fileId ? (
        <StudyBatchOcr key={`${book.id}:${index}`} book={book} fileId={fileId} page={index} draft={batchDraft}
          onClose={() => setOcrMode(undefined)} onSave={() => {
            if (needsOriginal) setSurfaceChoice({ visit: location.key, surface: "layout" });
            clearSelection();
          }} />
      ) : null}
      {visualAction?.action === "card" ? (
        <StudyVisualCard
          capture={visualAction.capture}
          onClose={() => setVisualAction(undefined)}
          onSave={(card) => saveVisualCard(card, visualAction.section)}
        />
      ) : null}
      {visualAction?.action === "discuss" ? (
        <StudyImageDiscussion
          capture={visualAction.capture}
          onClose={() => setVisualAction(undefined)}
          onStart={(capture) => startImageChat(visualAction.section, capture)}
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
