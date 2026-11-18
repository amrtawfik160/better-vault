import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { StudyText } from "./study-text";
import { flashcardMaterialLimit, flashcardPassageSize } from "@/lib/study/ai";
import { directionalInline, DirectionalText } from "@/components/common/directional-text";
import { Button } from "@/components/panelui/button";
import { StudyEpubChapter, type StudyEpubTheme } from "./study-epub-chapter";
import { StudyPdfPage } from "./study-pdf-page";
import { StudyFlashcardDraftDialog, type FlashcardSource } from "./study-flashcard-generator";
import { renderedSelection } from "./study-rendered-text";
import { useStudyReadingPlace } from "./study-reading-place";
import { Input } from "@/components/panelui/input";
import { Textarea } from "@/components/panelui/textarea";
import { Menu } from "@/components/panelui/menu";
import { loadBlob } from "@/lib/db/blobs";
import { useSource } from "@/lib/db/sources";
import { reviewReturnState } from "@/lib/study/review-session";
import {
  freshSchedule,
  putStudyRecords,
  recordStudyActivity,
  saveStudyCard,
  saveStudyNote,
  saveStudyText,
  saveStudyWord,
  studyId,
  StudyTextConflict,
  updateStudyBook,
} from "@/lib/db/study";
import { routes } from "@/lib/routes";
import { textDirection, textLines } from "@/lib/text/direction";
import { askStudyModel } from "@/lib/study/client";
import { originHref, studyHref, studyNotesHref } from "@/lib/study/links";
import type { StudyBook, StudyOrigin, StudyRecordOf, StudyThread } from "@/lib/study/records";
import { locateStudyMark, resolveStudyRange, studyTextRevision } from "@/lib/study/text-edits";

const colors = {
  yellow: "bg-yellow-200 text-yellow-950 dark:bg-yellow-900 dark:text-yellow-100",
  green: "bg-green-200 text-green-950 dark:bg-green-900 dark:text-green-100",
  blue: "bg-blue-200 text-blue-950 dark:bg-blue-900 dark:text-blue-100",
  pink: "bg-pink-200 text-pink-950 dark:bg-pink-900 dark:text-pink-100",
};

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
          className={colors[range.color]}
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
  highlights,
  openPage,
  resume,
  openPassage,
  startChat,
  openingTutor,
  layoutCheckpoint,
  back,
}: {
  book: StudyBook;
  viewport: HTMLDivElement | null;
  vaultId: string;
  requestedPage?: number;
  reference: boolean;
  focusedHighlight?: string;
  focusedRange?: { offset: number; length: number; revision?: number };
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
  openingTutor: boolean;
  layoutCheckpoint: RefObject<(() => void) | null>;
  back: () => void;
}) {
  const [openedSection] = useState(book.section);
  const index = Math.min(Math.max(0, requestedPage ?? openedSection), book.sections.length - 1);
  const section = book.sections[index];
  const revision = studyTextRevision(book);
  const navigate = useNavigate();
  const location = useLocation();
  const returnState = reviewReturnState(location.state);
  const visitingPassage = reference || !!(focusedHighlight || focusedRange);
  const { t } = useTranslation("home");
  const source = useSource(book.sourceId);
  const fileId = source === null ? undefined : book.fileId;
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
  const [language, setLanguage] = useState("");
  const [translating, setTranslating] = useState(false);
  const [color, setColor] = useState<keyof typeof colors>("yellow");
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<{ original: string; text: string } | null>(null);
  const [savingText, setSavingText] = useState(false);
  const [font, setFont] = useState(18);
  const [zoom, setZoom] = useState(100);
  const [epubTheme, setEpubTheme] = useState<StudyEpubTheme>("system");
  const [showLayout, setShowLayout] = useState(
    !visitingPassage && book.readingPlace?.section === index && book.readingPlace.surface === "layout",
  );
  const [readingSurface, setReadingSurface] = useState<{ section: number; root: HTMLElement | null }>();
  const viewPdf = showLayout && book.format === "pdf";
  const viewEpub = showLayout && book.format === "epub";
  const layout = showLayout && fileId && readingSurface?.section === index
    ? readingSurface.root : undefined;
  const [result, setResult] = useState<AssistResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileUrl, setFileUrl] = useState<string>();
  const pendingAssist = useRef<AbortController | null>(null);
  const started = useRef(0);
  const latestInteraction = useRef(0);
  const restoredLayout = useStudyReadingPlace({
    book,
    section: index,
    revision,
    visit: location.key,
    viewport,
    article: textBody,
    layout,
    loadingLayout: Boolean(showLayout && fileId && layout === undefined),
    enabled: !visitingPassage && !edit,
    activity: latestInteraction,
    layoutCheckpoint,
  });
  const pageHighlights = highlights.flatMap((item) => {
    if (item.section !== index) return [];
    const offset = locateStudyMark(book, item);
    return offset < 0 ? [] : [{ ...item, offset }];
  });
  const bookmarkPlaces = book.bookmarkPlaces ?? [];

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
        void recordStudyActivity("reading", seconds, book.notebookId, {
          kind: "book",
          bookId: book.id,
          section: index,
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
  }, [book.id, book.notebookId, index]);

  useEffect(() => {
    let live = true;
    let url: string | undefined;
    if (fileId)
      void loadBlob(fileId).then((blob) => {
        if (!live || !blob) return;
        url = URL.createObjectURL(blob);
        setFileUrl(url);
      });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId]);

  useEffect(() => {
    if (restoredLayout.current === location.key) return;
    if (focusStart !== undefined)
      document.getElementById("focused-passage")?.scrollIntoView({ block: "center" });
    else if (missingPassage) passageNotice.current?.scrollIntoView({ block: "nearest" });
  }, [index, focusStart, focusLength, location.key, missingPassage, restoredLayout]);

  function clearSelection() {
    setSelection(null);
    setCardFront(null);
    setDraftSource(null);
    setTranslating(false);
    pendingAssist.current?.abort();
  }

  function go(page: number) {
    clearSelection();
    setEdit(null);
    setResult(null);
    setSearch("");
    openPage(page);
  }

  function toggleLayout(visible: boolean) {
    if (visible && !showLayout) setReadingSurface(undefined);
    setShowLayout(visible);
  }

  function capture() {
    latestInteraction.current = Date.now();
    const selected = window.getSelection();
    if (!selected?.rangeCount || selected.isCollapsed || !textBody.current) return;
    const range = selected.getRangeAt(0);
    if (!textBody.current.contains(range.commonAncestorContainer)) return;
    const prefix = range.cloneRange();
    prefix.selectNodeContents(textBody.current);
    prefix.setEnd(range.startContainer, range.startOffset);
    const raw = range.toString();
    if (!raw.trim()) return;
    setCardFront(null);
    setResult(null);
    pendingAssist.current?.abort();
    setSelection({
      text: raw.trim().slice(0, 3000),
      offset: prefix.toString().length + raw.length - raw.trimStart().length,
      revision,
    });
  }

  function captureRendered(root: HTMLElement) {
    const selected = renderedSelection(root, section.text);
    if (selected === undefined) return;
    if (selected === null) {
      toast.error("Select this passage in the extracted text below to use it in Study.");
      return;
    }
    latestInteraction.current = Date.now();
    setCardFront(null);
    setResult(null);
    pendingAssist.current?.abort();
    setSelection({ ...selected, revision });
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
    const length = Math.min(selected?.text.length ?? section.text.length, flashcardMaterialLimit);
    const evidence = Array.from({ length: Math.ceil(length / flashcardPassageSize) }, (_, part) => {
      const start = part * flashcardPassageSize;
      return {
        ...origin,
        offset: (selected?.offset ?? 0) + start,
        length: Math.min(flashcardPassageSize, length - start),
        revision: selected?.revision ?? revision,
      };
    });
    setDraftSource({
      title: `${book.title} · ${section.title}`,
      text,
      origin,
      evidence,
      notebookId: book.notebookId,
      tags: [book.title],
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

  const query = search.trim();
  const pattern = query ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu") : null;
  const searchResults = pattern
    ? book.sections
        .flatMap((chapter, page) => {
          const match = pattern.exec(chapter.text);
          return !match
            ? []
            : [
                {
                  page,
                  offset: match.index,
                  length: match[0].length,
                  title: chapter.title,
                  teaser: chapter.text
                    .slice(Math.max(0, match.index - 32), match.index + match[0].length + 64)
                    .trim(),
                },
              ];
        })
        .slice(0, 15)
    : [];

  return (
    <section className="space-y-5">
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
            <Button variant="outline" onClick={() => {
              toggleLayout(book.readingPlace?.surface === "layout");
              resume();
            }}>
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
          {fileId && fileUrl ? (
            <a
              href={fileUrl}
              download={`${book.title}.${book.format === "text" ? "txt" : book.format}`}
              className="rounded-lg border px-3 py-2 text-sm hover:bg-accent"
            >
              Download original
            </a>
          ) : null}
          {book.format === "pdf" && fileId ? (
            <Button variant="outline" onClick={() => toggleLayout(!viewPdf)}>
              {viewPdf ? "Hide original page" : "Show original page"}
            </Button>
          ) : null}
          {book.format === "epub" && fileId ? (
            <Button variant="outline" onClick={() => toggleLayout(!viewEpub)}>
              {viewEpub ? "Hide book layout" : "Show book layout"}
            </Button>
          ) : null}
        </div>
      </div>
      {source === null ? (
        <p className="text-sm text-muted-foreground">{t("study.capture.sourceRemoved")}</p>
      ) : null}
      <div className="grid gap-3 rounded-2xl border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={index === 0} onClick={() => go(index - 1)}>
            Previous
          </Button>
          <select
            className="min-w-0 flex-1 rounded-lg border bg-background p-2 text-sm"
            aria-label="Reading position"
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
            size="sm"
            variant="outline"
            disabled={index === book.sections.length - 1}
            onClick={() => go(index + 1)}
          >
            Next
          </Button>
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
                    })}
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
                <DirectionalText
                  as="blockquote"
                  multiline
                  text={selectedHighlight.quote}
                  className="mt-1 wrap-break-word whitespace-pre-wrap"
                />
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
        <Input
          ref={searchInput}
          type="search"
          value={search}
          dir={textDirection(search)}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("study.reader.search")}
          aria-label={t("study.reader.search")}
        />
        {query ? (
          searchResults.length ? (
            <ul className="max-h-44 space-y-1 overflow-auto text-sm">
              {searchResults.map(({ page, offset, length, title, teaser }) => (
                <li key={page}>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-lg p-2 text-start hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      clearSelection();
                      setEdit(null);
                      setSearch("");
                      openPassage(page, { offset, length });
                    }}
                  >
                    <span className="block font-medium">{title}</span>
                    <DirectionalText
                      as="span"
                      text={teaser}
                      className="line-clamp-2 text-muted-foreground"
                    />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("study.capture.noMatches")}</p>
          )
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={openingTutor} onClick={() => startChat("chapter", index)}>
          Discuss this {book.format === "pdf" ? "page" : "chapter"}
        </Button>
        <Button size="sm" variant="outline" disabled={openingTutor} onClick={() => startChat("book", index)}>
          Discuss the book
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!section.text.trim()}
          onClick={() => draftCards(section.text)}
        >
          {t("study.capture.cardsFromSection")}
        </Button>
      </div>
      {book.format === "text" && !book.attachedToNotebook ? (
        edit === null ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEdit({ original: section.text, text: section.text })}
          >
            Edit text
          </Button>
        ) : (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!edit.text.trim() || savingText) return;
              setSavingText(true);
              void saveStudyText(book.id, edit.text, { section: index, original: edit.original })
                .then(() => {
                  clearSelection();
                  setEdit(null);
                })
                .catch((error: Error) =>
                  toast.error(
                    error instanceof StudyTextConflict
                      ? t("study.reader.editConflict")
                      : error.message,
                  ),
                )
                .finally(() => setSavingText(false));
            }}
          >
            <textarea
              aria-label="Edit document text"
              className="min-h-40 w-full rounded-xl border bg-background p-3"
              dir={textDirection(edit.text)}
              disabled={savingText}
              value={edit.text}
              onChange={(event) => setEdit({ ...edit, text: event.target.value })}
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={!edit.text.trim() || savingText}>
                Save changes
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={savingText}
                onClick={() => setEdit(null)}
              >
                Cancel
              </Button>
            </div>
          </form>
        )
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
              marks={pageHighlights}
              zoom={zoom}
              onSelect={captureRendered}
              onReadingSurface={setReadingSurface}
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
              marks={pageHighlights}
              font={font}
              theme={epubTheme}
              go={go}
              onSelect={captureRendered}
              onReadingSurface={setReadingSurface}
            />
          </>
        ) : null}
        <article
          ref={textBody}
          tabIndex={0}
          aria-label={section.title}
          className="mx-auto max-w-prose leading-relaxed wrap-break-word whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ fontSize: font }}
          onMouseUp={capture}
          onTouchEnd={capture}
          onKeyUp={capture}
          onPointerMove={() => {
            latestInteraction.current = Date.now();
          }}
        >
          {section.text
            ? highlighted(section.text, pageHighlights, focus)
            : "This page has no selectable text."}
        </article>
      </div>
      {selection ? (
        <div
          aria-label={t("study.capture.selectionActions")}
          className="sticky bottom-3 z-10 space-y-2 rounded-2xl border bg-popover p-3 shadow"
        >
          <div className="flex items-start justify-between gap-3">
            <DirectionalText
              text={selection.text}
              className="line-clamp-2 text-sm text-muted-foreground"
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
                  <Menu.GroupLabel>Highlight color</Menu.GroupLabel>
                  <Menu.RadioGroup
                    value={color}
                    onValueChange={(value) => {
                      if (
                        value === "yellow" ||
                        value === "green" ||
                        value === "blue" ||
                        value === "pink"
                      )
                        setColor(value);
                    }}
                  >
                    {Object.keys(colors).map((name) => (
                      <Menu.RadioItem key={name} value={name} className="capitalize">
                        {name}
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
