import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/panelui/button";
import { StudyEpubChapter, type StudyEpubTheme } from "./study-epub-chapter";
import { StudyPdfPage } from "./study-pdf-page";
import { renderedSelection } from "./study-rendered-text";
import { Input } from "@/components/panelui/input";
import { loadBlob } from "@/lib/db/blobs";
import {
  freshSchedule,
  putStudyRecords,
  recordStudyActivity,
  saveStudyCard,
  saveStudyNote,
  saveStudyText,
  studyId,
  updateStudyBook,
} from "@/lib/db/study";
import { routes } from "@/lib/routes";
import { askStudyModel } from "@/lib/study/client";
import { locateStudyQuote } from "@/lib/study/locators";
import { originHref, studyHref, studyNotesHref } from "@/lib/study/links";
import type { StudyBook, StudyOrigin, StudyRecordOf } from "@/lib/study/records";
import type { StudyAction } from "@/lib/study/ai";

const colors = {
  yellow: "bg-yellow-200 text-yellow-950 dark:bg-yellow-900 dark:text-yellow-100",
  green: "bg-green-200 text-green-950 dark:bg-green-900 dark:text-green-100",
  blue: "bg-blue-200 text-blue-950 dark:bg-blue-900 dark:text-blue-100",
  pink: "bg-pink-200 text-pink-950 dark:bg-pink-900 dark:text-pink-100",
};

type Selection = { text: string; offset: number };
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
  const nodes: ReactNode[] = [];
  let at = 0;
  const ranges = highlights
    .map((highlight) => ({
      ...highlight,
      offset: locateStudyQuote(text, highlight.quote, highlight.offset),
    }))
    .filter(
      (highlight) =>
        highlight.offset >= 0 &&
        (!focus ||
          highlight.offset >= focus.offset + focus.length ||
          highlight.offset + highlight.quote.length <= focus.offset),
    );
  for (const highlight of ranges.toSorted((a, b) => a.offset - b.offset)) {
    if (focus && at <= focus.offset && highlight.offset >= focus.offset + focus.length) {
      nodes.push(
        text.slice(at, focus.offset),
        <mark key="focused-passage" id="focused-passage" className={colors.blue}>
          {text.slice(focus.offset, focus.offset + focus.length)}
        </mark>,
      );
      at = focus.offset + focus.length;
    }
    const end = highlight.offset + highlight.quote.length;
    if (highlight.offset < at || text.slice(highlight.offset, end) !== highlight.quote) continue;
    nodes.push(text.slice(at, highlight.offset));
    nodes.push(
      <mark id={highlight.id} key={highlight.id} className={colors[highlight.color]}>
        {highlight.quote}
      </mark>,
    );
    at = end;
  }
  if (focus && at <= focus.offset) {
    nodes.push(
      text.slice(at, focus.offset),
      <mark key="focused-passage" id="focused-passage" className={colors.blue}>
        {text.slice(focus.offset, focus.offset + focus.length)}
      </mark>,
    );
    at = focus.offset + focus.length;
  }
  nodes.push(text.slice(at));
  return nodes;
}

export function StudyReader({
  book,
  requestedPage,
  focusedHighlight,
  focusedRange,
  highlights,
  openPage,
  startChat,
  back,
}: {
  book: StudyBook;
  requestedPage?: number;
  focusedHighlight?: string;
  focusedRange?: { offset: number; length: number };
  highlights: StudyRecordOf<"highlight">[];
  openPage: (section: number) => void;
  startChat: (
    scope: "passage" | "chapter" | "book",
    section: number,
    selection?: Selection,
  ) => void;
  back: () => void;
}) {
  const index = Math.min(Math.max(0, requestedPage ?? book.section), book.sections.length - 1);
  const section = book.sections[index];
  const navigate = useNavigate();
  const focus =
    focusedRange &&
    focusedRange.length > 0 &&
    focusedRange.offset + focusedRange.length <= section.text.length
      ? focusedRange
      : undefined;
  const focusStart = focus?.offset;
  const focusLength = focus?.length;
  const textBody = useRef<HTMLElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [cardFront, setCardFront] = useState<string | null>(null);
  const [language, setLanguage] = useState("");
  const [color, setColor] = useState<keyof typeof colors>("yellow");
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<string | null>(null);
  const [font, setFont] = useState(18);
  const [zoom, setZoom] = useState(100);
  const [epubTheme, setEpubTheme] = useState<StudyEpubTheme>("system");
  const [viewPdf, setViewPdf] = useState(false);
  const [viewEpub, setViewEpub] = useState(false);
  const [result, setResult] = useState<AssistResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileUrl, setFileUrl] = useState<string>();
  const pendingAssist = useRef<AbortController | null>(null);
  const started = useRef(0);
  const latestInteraction = useRef(0);
  const pageHighlights = highlights.filter((item) => item.section === index);
  const bookmarkPlaces = book.bookmarkPlaces ?? [];

  useEffect(() => {
    void updateStudyBook(book.id, { section: index });
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
    if (book.fileId)
      void loadBlob(book.fileId).then((blob) => {
        if (!live || !blob) return;
        url = URL.createObjectURL(blob);
        setFileUrl(url);
      });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [book.fileId]);

  useEffect(() => {
    const target = focusedHighlight ?? (focusStart === undefined ? undefined : "focused-passage");
    if (target) document.getElementById(target)?.scrollIntoView({ block: "center" });
  }, [focusedHighlight, index, highlights.length, focusStart, focusLength]);

  function go(page: number) {
    setSelection(null);
    setCardFront(null);
    setEdit(null);
    setResult(null);
    setSearch("");
    openPage(page);
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
    setSelection(selected);
  }

  function sourceOf(selected?: Selection | null): StudyOrigin {
    return selected
      ? {
          kind: "book",
          bookId: book.id,
          section: index,
          offset: selected.offset,
          length: selected.text.length,
        }
      : { kind: "book", bookId: book.id, section: index };
  }

  async function assist(action: StudyAction) {
    const selected = selection;
    if (action !== "cards" && !selected) return;
    const controller = new AbortController();
    pendingAssist.current?.abort();
    pendingAssist.current = controller;
    setBusy(true);
    setResult(null);
    const quote = selected?.text ?? section.text.slice(0, 12_000);
    try {
      const response = await askStudyModel({
        action,
        input: action === "translate" ? `Language: ${language}\nText: ${quote}` : quote,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (action === "cards") {
        await Promise.all(
          (response.cards ?? []).map(({ front, back }) =>
            saveStudyCard({
              front,
              back,
              tags: [book.title],
              notebookId: book.notebookId,
              origin: sourceOf(selected),
            }),
          ),
        );
        toast.success(`${response.cards?.length ?? 0} cards added`, {
          action: {
            label: "View flashcards",
            onClick: () => navigate(studyHref("cards", { book: book.id })),
          },
        });
      } else if (selected && (action === "translate" || action === "explain")) {
        setResult({ action, text: response.text, selection: selected, language });
      }
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

  function makeNote(selected: Selection) {
    void saveStudyNote({
      title: `${book.title} · ${section.title}`,
      body: selected.text,
      origin: sourceOf(selected),
      notebookId: book.notebookId,
    })
      .then((note) =>
        toast.success("Saved to Notes", {
          action: {
            label: "Open note",
            onClick: () => navigate(originHref({ kind: "note", noteId: note.id })),
          },
        }),
      )
      .catch((error: Error) => toast.error(error.message));
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Button size="sm" variant="ghost" onClick={back}>
            ← Library
          </Button>
          <h2 className="text-xl font-semibold wrap-break-word" dir="auto">
            {book.title}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={routes.notebook(book.notebookId)}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-accent"
          >
            Open notebook
          </Link>
          <Link
            className="rounded-lg border px-3 py-2 text-sm hover:bg-accent"
            to={studyNotesHref(book.notebookId)}
          >
            Notes
          </Link>
          <Link
            className="rounded-lg border px-3 py-2 text-sm hover:bg-accent"
            to={studyHref("cards", { book: book.id })}
          >
            Flashcards
          </Link>
          <Link
            className="rounded-lg border px-3 py-2 text-sm hover:bg-accent"
            to={studyHref("highlights", { book: book.id })}
          >
            Highlights
          </Link>
          {fileUrl ? (
            <a
              href={fileUrl}
              download={`${book.title}.${book.format === "text" ? "txt" : book.format}`}
              className="rounded-lg border px-3 py-2 text-sm hover:bg-accent"
            >
              Download original
            </a>
          ) : null}
          {book.format === "pdf" && book.fileId ? (
            <Button variant="outline" onClick={() => setViewPdf(!viewPdf)}>
              {viewPdf ? "Hide original page" : "Show original page"}
            </Button>
          ) : null}
          {book.format === "epub" && book.fileId ? (
            <Button variant="outline" onClick={() => setViewEpub(!viewEpub)}>
              {viewEpub ? "Hide book layout" : "Show book layout"}
            </Button>
          ) : null}
        </div>
      </div>
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
            {bookmarkPlaces.map(({ id, section, quote, offset }) => {
              const at = locateStudyQuote(book.sections[section]?.text ?? "", quote, offset);
              return (
                <div key={id} className="flex items-center gap-1 rounded-md bg-muted ps-2">
                  <Link
                    className="max-w-56 truncate underline"
                    to={originHref({
                      kind: "book",
                      bookId: book.id,
                      section,
                      ...(at === -1 ? {} : { offset: at, length: quote.length }),
                    })}
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
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search this document"
          aria-label="Search this document"
        />
        {search.trim() ? (
          <ul className="max-h-40 space-y-1 overflow-auto text-sm">
            {book.sections
              .map((chapter, i) => ({ chapter, i }))
              .filter(({ chapter }) =>
                chapter.text.toLowerCase().includes(search.trim().toLowerCase()),
              )
              .map(({ chapter, i }) => (
                <li key={i}>
                  <Button size="sm" variant="ghost" onClick={() => go(i)}>
                    {chapter.title}
                  </Button>
                </li>
              ))}
          </ul>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => startChat("chapter", index)}>
          Discuss this {book.format === "pdf" ? "page" : "chapter"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => startChat("book", index)}>
          Discuss the book
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !section.text}
          onClick={() => void assist("cards")}
        >
          Generate flashcards
        </Button>
      </div>
      {book.format === "text" ? (
        edit === null ? (
          <Button variant="outline" size="sm" onClick={() => setEdit(section.text)}>
            Edit text
          </Button>
        ) : (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void saveStudyText(book.id, edit)
                .then(() => setEdit(null))
                .catch((error: Error) => toast.error(error.message));
            }}
          >
            <textarea
              aria-label="Edit document text"
              className="min-h-40 w-full rounded-xl border bg-background p-3"
              dir="auto"
              value={edit}
              onChange={(event) => setEdit(event.target.value)}
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={!edit.trim()}>
                Save changes
              </Button>
              <Button variant="ghost" onClick={() => setEdit(null)}>
                Cancel
              </Button>
            </div>
          </form>
        )
      ) : null}
      <div className="space-y-4 rounded-2xl border bg-card p-5 sm:p-8">
        {viewPdf && book.fileId ? (
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
              fileId={book.fileId}
              page={index}
              sectionText={section.text}
              marks={pageHighlights}
              zoom={zoom}
              onSelect={captureRendered}
            />
          </>
        ) : null}
        {viewEpub && book.fileId ? (
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
              fileId={book.fileId}
              section={section}
              index={index}
              sections={book.sections}
              marks={pageHighlights}
              font={font}
              theme={epubTheme}
              go={go}
              onSelect={captureRendered}
            />
          </>
        ) : null}
        <article
          ref={textBody}
          tabIndex={0}
          dir="auto"
          aria-label={section.title}
          className="mx-auto max-w-prose leading-relaxed wrap-break-word whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ fontSize: font }}
          onMouseUp={capture}
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
        <div className="sticky bottom-3 z-10 space-y-2 rounded-2xl border bg-popover p-3 shadow">
          <p dir="auto" className="line-clamp-2 text-sm text-muted-foreground">
            {selection.text}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm">
              Color{" "}
              <select
                aria-label="Highlight color"
                className="rounded-lg border bg-background px-2 py-1"
                value={color}
                onChange={(event) => setColor(event.target.value as keyof typeof colors)}
              >
                {Object.keys(colors).map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
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
                  color,
                  note: "",
                  updatedAt: Date.now(),
                  schedule: freshSchedule(),
                })
                  .then(() => setSelection(null))
                  .catch((error: Error) => toast.error(error.message));
              }}
            >
              Highlight
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const exists = bookmarkPlaces.some(
                  (place) =>
                    place.section === index &&
                    place.offset === selection.offset &&
                    place.quote === selection.text,
                );
                if (exists) {
                  toast.info("This passage is already bookmarked.");
                  return;
                }
                void updateStudyBook(book.id, {
                  bookmarkPlaces: [
                    ...bookmarkPlaces,
                    {
                      id: studyId(),
                      section: index,
                      offset: selection.offset,
                      quote: selection.text,
                    },
                  ],
                })
                  .then(() => toast.success("Passage bookmarked"))
                  .catch((error: Error) => toast.error(error.message));
              }}
            >
              Bookmark selection
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
              onClick={() => startChat("passage", index, selection)}
            >
              Ask about selection
            </Button>
            <Button size="sm" variant="outline" onClick={() => makeNote(selection)}>
              Save to Notes
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCardFront("")}>
              Make flashcard
            </Button>
            <Input
              className="w-32"
              aria-label="Translate to"
              placeholder="Language"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !language.trim()}
              onClick={() => void assist("translate")}
            >
              Translate
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const translation =
                  result?.action === "translate" && result.selection === selection ? result : null;
                const id = studyId();
                void putStudyRecords({
                  id,
                  kind: "word",
                  origin: sourceOf(selection),
                  term: selection.text,
                  translation: translation?.text ?? "",
                  context: section.text.slice(
                    Math.max(0, selection.offset - 100),
                    selection.offset + selection.text.length + 100,
                  ),
                  language: translation?.language ?? language,
                  note: "",
                  notebookId: book.notebookId,
                  bookId: book.id,
                  updatedAt: Date.now(),
                })
                  .then(() =>
                    toast.success("Saved to vocabulary", {
                      action: {
                        label: "View word",
                        onClick: () => navigate(originHref({ kind: "word", wordId: id })),
                      },
                    }),
                  )
                  .catch((error: Error) => toast.error(error.message));
              }}
            >
              Save vocabulary
            </Button>
          </div>
          {cardFront !== null ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!cardFront.trim()) return;
                void saveStudyCard({
                  front: cardFront.trim(),
                  back: selection.text,
                  tags: [book.title],
                  notebookId: book.notebookId,
                  origin: sourceOf(selection),
                })
                  .then(() => {
                    setCardFront(null);
                    toast.success("Flashcard created", {
                      action: {
                        label: "View flashcards",
                        onClick: () => navigate(studyHref("cards", { book: book.id })),
                      },
                    });
                  })
                  .catch((error: Error) => toast.error(error.message));
              }}
            >
              <Input
                value={cardFront}
                onChange={(event) => setCardFront(event.target.value)}
                aria-label="Front of flashcard"
                placeholder="Question to review"
                className="max-w-sm"
              />
              <Button type="submit" size="sm" disabled={!cardFront.trim()}>
                Save flashcard
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCardFront(null)}>
                Cancel
              </Button>
            </form>
          ) : null}
          {result && result.selection === selection ? (
            <p dir="auto" className="text-sm whitespace-pre-wrap">
              {result.text}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
