import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import { loadBlob } from "@/lib/db/blobs";
import {
  freshSchedule,
  putStudyRecords,
  recordStudyActivity,
  saveStudyText,
  studyId,
  updateStudyBook,
} from "@/lib/db/study";
import { routes } from "@/lib/routes";
import { askStudyModel } from "@/lib/study/client";
import type { StudyBook, StudyRecordOf } from "@/lib/study/records";
import type { StudyAction } from "@/lib/study/ai";

const colors = {
  yellow: "bg-yellow-200 text-yellow-950 dark:bg-yellow-900 dark:text-yellow-100",
  green: "bg-green-200 text-green-950 dark:bg-green-900 dark:text-green-100",
  blue: "bg-blue-200 text-blue-950 dark:bg-blue-900 dark:text-blue-100",
  pink: "bg-pink-200 text-pink-950 dark:bg-pink-900 dark:text-pink-100",
};

function highlighted(text: string, highlights: StudyRecordOf<"highlight">[]) {
  const nodes: ReactNode[] = [];
  let at = 0;
  for (const highlight of highlights.toSorted((a, b) => a.offset - b.offset)) {
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
  nodes.push(text.slice(at));
  return nodes;
}

function PdfPage({ fileId, page }: { fileId: string; page: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let destroy: (() => Promise<void>) | undefined;
    void (async () => {
      const blob = await loadBlob(fileId);
      if (!blob || !live) return;
      const { getDocumentProxy } = await import("unpdf");
      if (!live) return;
      const pdf = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()));
      destroy = () => pdf.loadingTask.destroy();
      if (!live) {
        await destroy();
        return;
      }
      const current = await pdf.getPage(page + 1);
      const element = canvas.current;
      if (!element || !live) return;
      const viewport = current.getViewport({ scale: 1.3 });
      element.width = Math.ceil(viewport.width);
      element.height = Math.ceil(viewport.height);
      await current.render({ canvas: element, viewport }).promise;
    })().catch(() => {
      if (live) setFailed(true);
    });
    return () => {
      live = false;
      void destroy?.().catch(() => {});
    };
  }, [fileId, page]);
  if (failed)
    return (
      <p className="text-sm text-muted-foreground">
        Could not render the original page. The extracted text is below.
      </p>
    );
  return (
    <canvas
      ref={canvas}
      className="mx-auto h-auto max-w-full rounded-lg border"
      role="img"
      aria-label={`Original PDF page ${page + 1}`}
    />
  );
}

export function StudyReader({
  book,
  requestedPage,
  focusedHighlight,
  highlights,
  openPage,
  startChat,
  back,
}: {
  book: StudyBook;
  requestedPage?: number;
  focusedHighlight?: string;
  highlights: StudyRecordOf<"highlight">[];
  openPage: (section: number) => void;
  startChat: (scope: "passage" | "chapter" | "book", section: number, quote?: string) => void;
  back: () => void;
}) {
  const index = Math.min(Math.max(0, requestedPage ?? book.section), book.sections.length - 1);
  const section = book.sections[index];
  const textBody = useRef<HTMLElement>(null);
  const [selection, setSelection] = useState<{ text: string; offset: number } | null>(null);
  const [language, setLanguage] = useState("");
  const [color, setColor] = useState<keyof typeof colors>("yellow");
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<string | null>(null);
  const [font, setFont] = useState(18);
  const [viewPdf, setViewPdf] = useState(false);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileUrl, setFileUrl] = useState<string>();
  const started = useRef(0);
  const latestInteraction = useRef(0);

  useEffect(() => {
    void updateStudyBook(book.id, { section: index });
    started.current = Date.now();
    latestInteraction.current = started.current;
    return () => {
      const seconds = Math.min(Date.now(), latestInteraction.current + 60_000) - started.current;
      if (seconds >= 1000) void recordStudyActivity("reading", seconds / 1000, book.notebookId);
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
    if (focusedHighlight)
      document.getElementById(focusedHighlight)?.scrollIntoView({ block: "center" });
  }, [focusedHighlight, index, highlights.length]);

  function go(page: number) {
    setSelection(null);
    setEdit(null);
    setResult("");
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
    setSelection({
      text: raw.trim().slice(0, 3000),
      offset: prefix.toString().length + raw.length - raw.trimStart().length,
    });
  }

  async function assist(action: StudyAction) {
    setBusy(true);
    setResult("");
    const quote = selection?.text ?? section.text.slice(0, 12_000);
    try {
      const response = await askStudyModel(
        action,
        action === "translate" ? `Language: ${language}\nText: ${quote}` : quote,
      );
      if (action === "cards") {
        await putStudyRecords(
          ...(response.cards ?? []).map(({ front, back }): StudyRecordOf<"card"> => ({
            id: studyId(),
            kind: "card",
            front,
            back,
            tags: [book.title],
            notebookId: book.notebookId,
            updatedAt: Date.now(),
            schedule: freshSchedule(),
          })),
        );
        toast.success(`${response.cards?.length ?? 0} cards added`);
      } else setResult(response.text);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
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
        {book.bookmarks.length ? (
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
        {viewPdf && book.fileId ? <PdfPage key={index} fileId={book.fileId} page={index} /> : null}
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
            ? highlighted(
                section.text,
                highlights.filter((item) => item.section === index),
              )
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
              disabled={busy}
              onClick={() => void assist("explain")}
            >
              Explain
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => startChat("passage", index, selection.text)}
            >
              Ask about selection
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
                void putStudyRecords({
                  id: studyId(),
                  kind: "word",
                  term: selection.text,
                  translation: result,
                  context: section.text.slice(
                    Math.max(0, selection.offset - 100),
                    selection.offset + selection.text.length + 100,
                  ),
                  language,
                  note: "",
                  bookId: book.id,
                  updatedAt: Date.now(),
                })
                  .then(() => toast.success("Saved to vocabulary"))
                  .catch((error: Error) => toast.error(error.message));
              }}
            >
              Save vocabulary
            </Button>
          </div>
          {result ? (
            <p dir="auto" className="text-sm whitespace-pre-wrap">
              {result}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
