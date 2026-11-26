import type { Notebook, SourceSummary } from "@/lib/db/types";
import type { StudyBook } from "./records";

/** The id of the Study document opened from a notebook source (`studyBookForSource`). */
export function sourceStudyBookId(sourceId: string) {
  return `source-${sourceId}`;
}

/**
 * Whether the document's text can be edited in the reader: any text or
 * Markdown document, however it came in. The edit rewrites the source's text
 * and passages too (`saveStudyText`).
 */
export function canEditStudyText(book: Pick<StudyBook, "format">) {
  return book.format === "text";
}

/**
 * Whether renaming a document renames its notebook too: a notebook named
 * after its only source, such as one made for a document added in Study.
 */
export function notebookFollowsDocument(
  notebook: Pick<Notebook, "title"> | undefined,
  otherSources: number,
  previousTitle: string | undefined,
) {
  return Boolean(notebook && previousTitle !== undefined && otherSources === 0 && notebook.title === previousTitle);
}

/**
 * One document on the Library's shelves: a Study book, or a readable source
 * not opened in Study yet. A book whose source was deleted from its notebook
 * stays readable from its own text, marked `sourceRemoved`.
 */
export type StudyLibraryEntry<Book extends Pick<StudyBook, "id" | "notebookId" | "sourceId" | "title">> =
  | { kind: "book"; id: string; notebookId: string; title: string; book: Book; sourceRemoved: boolean }
  | { kind: "source"; id: string; notebookId: string; title: string; source: SourceSummary };

/**
 * The Library's documents: every book, then every readable source without a
 * book. `sources` is `undefined` while loading; books are listed meanwhile.
 */
export function studyLibraryEntries<Book extends Pick<StudyBook, "id" | "notebookId" | "sourceId" | "title">>(
  books: readonly Book[],
  sources: readonly SourceSummary[] | undefined,
): StudyLibraryEntry<Book>[] {
  const key = (notebookId: string, sourceId: string) => JSON.stringify([notebookId, sourceId]);
  const known = new Set(sources?.map((source) => key(source.notebookId, source.id)));
  const read = new Set(books.map((book) => key(book.notebookId, book.sourceId)));
  return [
    ...books.map((book) => ({
      kind: "book" as const,
      id: book.id,
      notebookId: book.notebookId,
      title: book.title,
      book,
      sourceRemoved: sources !== undefined && !known.has(key(book.notebookId, book.sourceId)),
    })),
    ...(sources ?? [])
      .filter((source) => source.readable && !read.has(key(source.notebookId, source.id)))
      .map((source) => ({
        kind: "source" as const,
        id: source.id,
        notebookId: source.notebookId,
        title: source.title,
        source,
      })),
  ];
}

export interface StudyShelf<Book extends Pick<StudyBook, "notebookId">> {
  notebookId: string;
  books: Book[];
}

/** The documents grouped by notebook, in the order their first document comes. */
export function studyShelves<Book extends Pick<StudyBook, "notebookId">>(books: readonly Book[]): StudyShelf<Book>[] {
  const shelves = new Map<string, Book[]>();
  for (const book of books) {
    const shelf = shelves.get(book.notebookId);
    if (shelf) shelf.push(book);
    else shelves.set(book.notebookId, [book]);
  }
  return [...shelves].map(([notebookId, books]) => ({ notebookId, books }));
}

/**
 * Notebooks made to hold one document: a single source, read in Study, with
 * the notebook named after it (renames keep the two names together).
 */
export function libraryNotebookIds(
  books: readonly Pick<StudyBook, "notebookId" | "title">[],
  sourceCounts: ReadonlyMap<string, { sources: number }>,
  notebooks: readonly Pick<Notebook, "id" | "title">[],
) {
  const titles = new Map(notebooks.map(({ id, title }) => [id, title]));
  const ids = new Set<string>();
  for (const book of books) {
    if (sourceCounts.get(book.notebookId)?.sources === 1 && titles.get(book.notebookId) === book.title)
      ids.add(book.notebookId);
  }
  return ids;
}
