import type { Note, Notebook, Vault } from "@/lib/db/types";
import type { StudyBook, StudyOrigin, StudyRecord } from "./records";
import { DEFAULT_VAULT, studyOriginRecordId, studyVaultIndex } from "./vault";

/** What a book's notebook holds outside the study table. */
export type StudyBookNotebookContent = {
  /** Sources other than the book's own. */
  otherSources: boolean;
  conversations: boolean;
  outputs: boolean;
};

export type StudyBookDeletion = {
  book: StudyBook;
  /** The book and the rows that only exist on it: highlights, scan and document drafts. */
  remove: string[];
  /** Rows made from the book that stay, saved with the vault they were in. */
  keep: StudyRecord[];
  /** The book's own source goes with it (an imported book whose source no other book reads). */
  deleteSource: boolean;
  /** Nothing else is left in the notebook once the book is gone. */
  deleteNotebook: boolean;
};

type Data = {
  rows: readonly StudyRecord[];
  notebooks: readonly Pick<Notebook, "id" | "vaultId">[];
  notes: readonly Pick<Note, "id" | "vaultId" | "notebookId">[];
  vaults: readonly Pick<Vault, "id">[];
};

function origins(row: StudyRecord): (StudyOrigin | undefined)[] {
  switch (row.kind) {
    case "card":
      return [row.origin, ...(row.citations ?? []).map((cite) => ("origin" in cite ? cite.origin : undefined))];
    case "word":
      return [row.origin, ...(row.examples ?? []).map(({ origin }) => origin)];
    case "session":
      return [row.origin];
    case "practice":
      return [...row.material.origins, ...row.passages.map(({ origin }) => origin)];
    default:
      return [];
  }
}

function linkedIds(row: StudyRecord): (string | undefined)[] {
  const ids = origins(row).map(studyOriginRecordId);
  if (row.kind === "session") ids.push(row.itemId);
  if (row.kind === "thread")
    ids.push(...(row.highlightIds ?? []), ...(row.cardIds ?? []), row.practiceCardId);
  return ids;
}

/**
 * Works out what deleting a Study book removes, so both stores do the same in
 * one transaction.
 *
 * The book takes with it what only exists on it: its highlights, reading place
 * and bookmarks (fields of the book), and its scan and document drafts.
 * Flashcards, words, Tutor conversations, practice sessions and review history
 * made from it stay: they carry their own text, and their schedules are the
 * learner's progress. They keep the vault they were in.
 *
 * An imported book (not `attachedToNotebook`) also takes its own source, and
 * its notebook when nothing else is left there: no other source, chat, output,
 * note or study record. A book read from a notebook source leaves both.
 */
export function studyBookDeletion(
  data: Data,
  bookId: string,
  content: StudyBookNotebookContent,
): StudyBookDeletion | undefined {
  const book = data.rows.find((row): row is StudyBook => row.kind === "book" && row.id === bookId);
  if (!book) return;
  const { notebookId, sourceId } = book;
  const bound = new Set([book.id]);
  for (const row of data.rows) {
    if ((row.kind === "highlight" || row.kind === "document-draft" || row.kind === "ocr-draft") && row.bookId === book.id)
      bound.add(row.id);
  }

  const ofBook = (origin: StudyOrigin | undefined) =>
    origin?.kind === "book"
      ? origin.bookId === book.id
      : origin?.kind === "source" && origin.notebookId === notebookId && origin.sourceId === sourceId;
  const madeFromBook = (row: StudyRecord) =>
    origins(row).some(ofBook) ||
    ("bookId" in row && row.bookId === book.id) ||
    (row.kind === "card" && (row.citations ?? []).some((cite) => "bookId" in cite && cite.bookId === book.id)) ||
    (row.kind === "thread" && Boolean(row.bookIds?.includes(book.id) || row.sourceIds?.includes(sourceId)));

  // Rows made from the book, directly or through another such row (a word's
  // card, a highlight's review history).
  const derived = new Set<string>();
  const candidates = data.rows.filter((row) => row.kind !== "book" && !bound.has(row.id));
  for (let changed = true; changed; ) {
    changed = false;
    for (const row of candidates) {
      if (derived.has(row.id)) continue;
      if (madeFromBook(row) || linkedIds(row).some((id) => id && (bound.has(id) || derived.has(id)))) {
        derived.add(row.id);
        changed = true;
      }
    }
  }

  const attached = Boolean(book.attachedToNotebook);
  const sharedSource = data.rows.some(
    (row) => row.kind === "book" && row.id !== book.id && row.notebookId === notebookId && row.sourceId === sourceId,
  );
  const deleteSource = !attached && !sharedSource;
  const othersInNotebook =
    content.otherSources ||
    content.conversations ||
    content.outputs ||
    data.notes.some((note) => note.notebookId === notebookId) ||
    data.rows.some((row) => row.notebookId === notebookId && !bound.has(row.id) && !derived.has(row.id));
  const deleteNotebook = deleteSource && !othersInNotebook;

  const { owner } = studyVaultIndex({ ...data, defaultVaultId: DEFAULT_VAULT });
  const pointsAtNotebook = (row: StudyRecord) =>
    row.notebookId === notebookId ||
    origins(row).some((origin) => origin && "notebookId" in origin && origin.notebookId === notebookId);
  const keep = data.rows.flatMap((row) => {
    if (bound.has(row.id) || row.kind === "book") return [];
    if (!derived.has(row.id) && !(deleteNotebook && pointsAtNotebook(row))) return [];
    const next: StudyRecord = { ...row, vaultId: owner(row) };
    if (deleteNotebook && next.notebookId === notebookId) delete next.notebookId;
    return next.vaultId === row.vaultId && next.notebookId === row.notebookId ? [] : [next];
  });

  return { book, remove: [...bound], keep, deleteSource, deleteNotebook };
}
