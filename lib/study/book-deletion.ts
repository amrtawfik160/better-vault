import type { Note, Notebook, Vault } from "@/lib/db/types";
import type { StudyBook, StudyOrigin, StudyRecord } from "./records";
import { DEFAULT_VAULT, studyOriginRecordId, studyVaultIndex } from "./vault";

/** What a document's notebook holds outside the study table. */
export type StudyBookNotebookContent = {
  /** Sources other than the document's own. */
  otherSources: boolean;
  conversations: boolean;
  outputs: boolean;
};

/** A document: a notebook source, and the Study book that reads it when it has one. */
export type StudyDocument = { notebookId: string; sourceId: string };

export type StudyBookDeletion = {
  /** The Study book reading the source, when there is one. */
  book?: StudyBook;
  /** The book and the rows that only exist on it: highlights, scan and document drafts. */
  remove: string[];
  /** Rows made from the document that stay, saved with the vault they were in. */
  keep: StudyRecord[];
  /** Nothing else is left in the notebook once the document is gone. */
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

/** The Study book that reads a notebook source: there is at most one. */
export function studyBookOf(rows: readonly StudyRecord[], { notebookId, sourceId }: StudyDocument) {
  return rows.find(
    (row): row is StudyBook => row.kind === "book" && row.notebookId === notebookId && row.sourceId === sourceId,
  );
}

/**
 * Works out what "Delete document" removes, so both stores do the same in one
 * transaction. The same rules apply however the document came in.
 *
 * The source goes from its notebook, with its passages and files (the store
 * does that). Its Study book goes with what only exists on it: its
 * highlights, reading place and bookmarks (fields of the book), and its scan
 * and document drafts. Flashcards, words, Tutor conversations, practice
 * sessions and review history made from it stay: they carry their own text,
 * and their schedules are the learner's progress. They keep the vault they
 * were in.
 *
 * The notebook goes too when nothing else is left there: no other source,
 * chat, output, note or study record.
 */
export function studyBookDeletion(
  data: Data,
  document: StudyDocument,
  content: StudyBookNotebookContent,
): StudyBookDeletion {
  const { notebookId, sourceId } = document;
  const book = studyBookOf(data.rows, document);
  const bookId = book?.id;
  const bound = new Set<string>();
  if (bookId) {
    bound.add(bookId);
    for (const row of data.rows) {
      if ((row.kind === "highlight" || row.kind === "document-draft" || row.kind === "ocr-draft") && row.bookId === bookId)
        bound.add(row.id);
    }
  }

  const ofDocument = (origin: StudyOrigin | undefined) =>
    origin?.kind === "book"
      ? origin.bookId === bookId
      : origin?.kind === "source" && origin.notebookId === notebookId && origin.sourceId === sourceId;
  const madeFromDocument = (row: StudyRecord) =>
    origins(row).some(ofDocument) ||
    (bookId !== undefined && "bookId" in row && row.bookId === bookId) ||
    (row.kind === "card" && (row.citations ?? []).some((cite) => "bookId" in cite && cite.bookId === bookId)) ||
    (row.kind === "thread" && Boolean((bookId && row.bookIds?.includes(bookId)) || row.sourceIds?.includes(sourceId)));

  // Rows made from the document, directly or through another such row (a
  // word's card, a highlight's review history).
  const derived = new Set<string>();
  const candidates = data.rows.filter((row) => row.kind !== "book" && !bound.has(row.id));
  for (let changed = true; changed; ) {
    changed = false;
    for (const row of candidates) {
      if (derived.has(row.id)) continue;
      if (madeFromDocument(row) || linkedIds(row).some((id) => id && (bound.has(id) || derived.has(id)))) {
        derived.add(row.id);
        changed = true;
      }
    }
  }

  const othersInNotebook =
    content.otherSources ||
    content.conversations ||
    content.outputs ||
    data.notes.some((note) => note.notebookId === notebookId) ||
    data.rows.some((row) => row.notebookId === notebookId && !bound.has(row.id) && !derived.has(row.id));
  const deleteNotebook = !othersInNotebook;

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

  return { book, remove: [...bound], keep, deleteNotebook };
}

/**
 * "Remove reading progress": the book keeps its text, its text edits and how
 * it is shown, so what was made from it still finds its passages, and forgets
 * where the reader was and its bookmarks. The store deletes its highlights in
 * the same transaction.
 */
export function studyBookWithoutProgress(book: StudyBook, updatedAt: number): StudyBook {
  const { readingPlace: _place, lastReadAt: _read, bookmarkPlaces: _places, ...rest } = book;
  return { ...rest, section: 0, bookmarks: [], updatedAt: Math.max(book.updatedAt, updatedAt) };
}
