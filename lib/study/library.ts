import type { StudyBook } from "./records";

/** The id of the Study document opened from a notebook source (`studyBookForSource`). */
export function sourceStudyBookId(sourceId: string) {
  return `source-${sourceId}`;
}

/**
 * Whether the document's text can be edited in the reader: a text document
 * made in Study, whether it has a notebook of its own or was added to one.
 * A notebook source opened in Study keeps the text the notebook gave it.
 */
export function canEditStudyText(book: Pick<StudyBook, "id" | "format" | "sourceId" | "attachedToNotebook">) {
  return book.format === "text" && (!book.attachedToNotebook || book.id !== sourceStudyBookId(book.sourceId));
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
 * Notebooks made only to hold one document added to Study: a single source,
 * read by a Study document that owns the notebook (not attached to it).
 */
export function libraryNotebookIds(
  books: readonly Pick<StudyBook, "notebookId" | "sourceId" | "attachedToNotebook">[],
  sourceCounts: ReadonlyMap<string, { sources: number }>,
) {
  const ids = new Set<string>();
  for (const book of books) {
    if (!book.attachedToNotebook && sourceCounts.get(book.notebookId)?.sources === 1) ids.add(book.notebookId);
  }
  return ids;
}
