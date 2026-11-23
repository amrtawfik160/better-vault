import { studyDocumentDraftId } from "./document-drafts";
import { sourceStudyBookId } from "./library";
import { scanDraftId } from "./ocr-write";
import type { StudyBook, StudyCitation, StudyOrigin, StudyRecord, StudyRecordOf } from "./records";
import { resolveStudyRange, studyTextRevision } from "./text-edits";
import { studyImagePrefix } from "./visual-card";

/**
 * What it takes to give every notebook source at most one Study book, and to
 * drop the old `attachedToNotebook` flag. Both stores run it in one
 * transaction: as a schema upgrade (Dexie version 11, SQLite migration 9)
 * and after importing a backup, so an old backup ends up the same as a
 * migrated database. Running it again changes nothing.
 */
export type StudyBookMerge = {
  /** Rows to write: kept books, books that lose `attachedToNotebook`, re-pointed rows and moved drafts. */
  put: StudyRecord[];
  /** Rows to delete: the merged-away books, and drafts whose id named one (written again under the kept id). */
  remove: string[];
  /** Each merged-away book id and the id of the book it was merged into. */
  moved: Map<string, string>;
};

/** Study rows are plain JSON; this drops the fields left `undefined` by the rewrites. */
const plain = <T>(row: T): T => JSON.parse(JSON.stringify(row)) as T;
/** A row as JSON with its keys sorted, to tell whether two rows hold the same. */
const canonical = (row: unknown) =>
  JSON.stringify(row, (_, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value,
  );

type Move = { from: StudyBook; kept: StudyBook };
type Place = { section: number; offset: number; length: number; revision?: number; quote?: string };

const documentKey = ({ notebookId, sourceId }: Pick<StudyBook, "notebookId" | "sourceId">) =>
  JSON.stringify([notebookId, sourceId]);

/** The book ids a row points at, for telling which duplicate was used first. */
function referencedBooks(row: StudyRecord): (string | undefined)[] {
  const ofOrigin = (origin: StudyOrigin | undefined) => (origin?.kind === "book" ? origin.bookId : undefined);
  const ofCitation = (cite: StudyCitation) => ("origin" in cite ? ofOrigin(cite.origin) : cite.bookId);
  switch (row.kind) {
    case "highlight":
    case "ocr-draft":
    case "document-draft":
      return [row.bookId];
    case "word":
      return [row.bookId, ofOrigin(row.origin), ...(row.examples ?? []).map(({ origin }) => ofOrigin(origin))];
    case "card":
      return [ofOrigin(row.origin), ...(row.citations ?? []).map(ofCitation)];
    case "session":
      return [ofOrigin(row.origin)];
    case "thread":
      return [row.bookId, ...(row.bookIds ?? []), ...row.messages.flatMap(({ citations }) => (citations ?? []).map(ofCitation))];
    case "practice":
      return [...row.material.origins.map(ofOrigin), ...row.passages.map(({ origin }) => ofOrigin(origin))];
    case "book":
      return [];
  }
}

/**
 * Where a passage of `from` is in `to`'s current text. The same text gives the
 * same place; otherwise its quote is looked for, and used when it occurs once.
 */
function rebase(from: StudyBook, to: StudyBook, at: Place) {
  const target = to.sections[at.section]?.text;
  if (target === undefined || at.length < 1) return;
  const current = from.sections[at.section]?.text;
  const range = resolveStudyRange(from, at.section, at);
  const revision = studyTextRevision(to);
  if (range && current === target) return { offset: range.offset, revision };
  const quote = at.quote || (range && current?.slice(range.offset, range.offset + range.length));
  if (!quote) return;
  const found = target.indexOf(quote);
  if (found >= 0 && found === target.lastIndexOf(quote)) return { offset: found, revision };
}

/** A marked passage (a highlight or a bookmarked passage) moved to the kept book. Its quote is kept either way. */
function movedMark<Mark extends { section: number; offset: number; quote: string; revision?: number }>(
  mark: Mark,
  move: Move,
): Mark {
  const place = rebase(move.from, move.kept, { ...mark, length: mark.quote.length });
  // Unplaced, it is looked for by its quote in the kept book's current text.
  return { ...mark, offset: place?.offset ?? mark.offset, revision: place?.revision ?? studyTextRevision(move.kept) };
}

function movedOrigin<Origin extends StudyOrigin | undefined>(origin: Origin, moves: Map<string, Move>): Origin {
  if (origin?.kind !== "book") return origin;
  const move = moves.get(origin.bookId);
  if (!move) return origin;
  const next: Extract<StudyOrigin, { kind: "book" }> = { ...origin, bookId: move.kept.id };
  if (origin.section !== undefined && origin.offset !== undefined) {
    const place = rebase(move.from, move.kept, {
      section: origin.section,
      offset: origin.offset,
      length: origin.length ?? 0,
      revision: origin.revision,
    });
    if (place) Object.assign(next, place);
    else {
      delete next.offset;
      delete next.length;
      delete next.revision;
    }
  }
  return next as Origin;
}

function movedCitation(cite: StudyCitation, moves: Map<string, Move>): StudyCitation {
  if ("origin" in cite) return { ...cite, origin: movedOrigin(cite.origin, moves) };
  const move = moves.get(cite.bookId);
  return move ? { ...cite, bookId: move.kept.id } : cite;
}

const movedIds = (ids: string[] | undefined, moves: Map<string, Move>) =>
  ids && [...new Set(ids.map((id) => moves.get(id)?.kept.id ?? id))];

type Context = { bookId?: string; section?: number; quote?: string; offset?: number; revision?: number; bookIds?: string[] };

/** A Tutor context (a conversation's, or a report's practice context) moved to the kept book. */
function movedContext<T extends Context>(context: T, moves: Map<string, Move>): T {
  const next = { ...context };
  if (context.bookIds) next.bookIds = movedIds(context.bookIds, moves);
  const move = context.bookId ? moves.get(context.bookId) : undefined;
  if (!move) return next;
  next.bookId = move.kept.id;
  if (context.section !== undefined && context.offset !== undefined) {
    const place = rebase(move.from, move.kept, {
      section: context.section,
      offset: context.offset,
      length: context.quote?.length || 1,
      revision: context.revision,
      quote: context.quote,
    });
    if (place) Object.assign(next, place);
    else {
      delete next.offset;
      delete next.revision;
    }
  }
  return next;
}

function movedRow(row: StudyRecord, moves: Map<string, Move>): StudyRecord {
  switch (row.kind) {
    case "highlight": {
      const move = moves.get(row.bookId);
      return move ? { ...movedMark(row, move), bookId: move.kept.id } : row;
    }
    case "document-draft":
    case "ocr-draft": {
      const move = row.bookId ? moves.get(row.bookId) : undefined;
      return move ? { ...row, bookId: move.kept.id } : row;
    }
    case "word": {
      const move = row.bookId ? moves.get(row.bookId) : undefined;
      return {
        ...row,
        ...(move && { bookId: move.kept.id }),
        origin: movedOrigin(row.origin, moves),
        ...(row.examples && {
          examples: row.examples.map((example) => ({ ...example, origin: movedOrigin(example.origin, moves) })),
        }),
      };
    }
    case "card":
      return {
        ...row,
        origin: movedOrigin(row.origin, moves),
        ...(row.citations && { citations: row.citations.map((cite) => movedCitation(cite, moves)) }),
      };
    case "session":
      return { ...row, origin: movedOrigin(row.origin, moves) };
    case "thread": {
      const report = <R extends { practiceContext?: Context }>(entry: R): R =>
        entry.practiceContext ? { ...entry, practiceContext: movedContext(entry.practiceContext, moves) } : entry;
      return {
        ...movedContext(row, moves),
        messages: row.messages.map((message) =>
          message.citations ? { ...message, citations: message.citations.map((cite) => movedCitation(cite, moves)) } : message,
        ),
        ...(row.report && { report: report(row.report) }),
        ...(row.pastReports && { pastReports: row.pastReports.map(report) }),
      };
    }
    case "practice":
      return {
        ...row,
        material: { ...row.material, origins: row.material.origins.map((origin) => movedOrigin(origin, moves)) },
        passages: row.passages.map((passage) => ({ ...passage, origin: movedOrigin(passage.origin, moves) })),
      };
    case "book":
      return row;
  }
}

/** The id a draft has once its book is merged: drafts are named after their book (`scanDraftId`, `studyDocumentDraftId`). */
function movedDraftId(row: StudyRecordOf<"document-draft" | "ocr-draft">, from: string, to: string) {
  if (row.kind === "ocr-draft") return row.id === scanDraftId(from) ? scanDraftId(to) : row.id;
  const section = row.id.match(/:(\d+)$/u)?.[1];
  return section !== undefined && row.id === studyDocumentDraftId({ bookId: from, section: Number(section) })
    ? studyDocumentDraftId({ bookId: to, section: Number(section) })
    : row.id;
}

/** The duplicates of one source merged into `kept`: bookmarks joined, the latest reading place kept. */
function mergedBook(kept: StudyBook, others: StudyBook[]): StudyBook {
  const all = [kept, ...others];
  const latest = all.reduce((best, book) => ((book.lastReadAt ?? -1) > (best.lastReadAt ?? -1) ? book : best));
  const bookmarks = [...new Set([...kept.bookmarks, ...others.flatMap(({ bookmarks }) => bookmarks)])]
    .filter((at) => kept.sections[at] !== undefined);
  const places = new Map<string, NonNullable<StudyBook["bookmarkPlaces"]>[number]>();
  for (const book of all) {
    for (const place of book.bookmarkPlaces ?? []) {
      if (places.has(place.id)) continue;
      places.set(place.id, book === kept ? place : movedMark(place, { from: book, kept }));
    }
  }
  const { attachedToNotebook: _, ...own } = kept;
  const next: StudyBook = {
    ...own,
    bookmarks,
    updatedAt: Math.max(...all.map(({ updatedAt }) => updatedAt)),
    readingAppearance: kept.readingAppearance ?? latest.readingAppearance,
    preferredReadingSurface: kept.preferredReadingSurface ?? latest.preferredReadingSurface,
    mergedIds: [...new Set([...(kept.mergedIds ?? []), ...others.flatMap(({ id, mergedIds }) => [id, ...(mergedIds ?? [])])])],
  };
  if (places.size) next.bookmarkPlaces = [...places.values()];
  if (latest.lastReadAt !== undefined) next.lastReadAt = latest.lastReadAt;
  if (latest !== kept && kept.sections[latest.section]) {
    next.section = latest.section;
    const place = latest.readingPlace;
    if (place?.section === latest.section) {
      const { anchor, endRevision, ...rest } = place;
      const moved = anchor && rebase(latest, kept, { section: place.section, ...anchor, length: anchor.quote.length });
      next.readingPlace = {
        ...rest,
        ...(moved && anchor && { anchor: { quote: anchor.quote, ...moved } }),
        ...(endRevision !== undefined && endRevision === studyTextRevision(latest) && { endRevision: studyTextRevision(kept) }),
      };
    } else delete next.readingPlace;
  }
  return plain(next);
}

/**
 * Finds the sources read by more than one Study book and merges each group
 * into its oldest book. A book made together with its source (imported in
 * Study, with an id of its own) is the oldest, since a `source-<id>` book can
 * only be opened once the source exists; between others, the one with the
 * earliest known activity, then the lower id. Highlights, words, origins,
 * threads, practice material and drafts of the merged-away ids are re-pointed
 * to the kept id, with their positions moved into its text when they can be.
 */
export function studyBookMerge(rows: readonly StudyRecord[]): StudyBookMerge {
  const groups = new Map<string, StudyBook[]>();
  for (const row of rows) {
    if (row.kind !== "book") continue;
    const key = documentKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const duplicates = [...groups.values()].filter((books) => books.length > 1);
  const put: StudyRecord[] = [];
  const remove: string[] = [];
  const moved = new Map<string, string>();
  const keptBooks = new Map<string, StudyBook>();
  const moves = new Map<string, Move>();

  if (duplicates.length) {
    const firstSeen = new Map<string, number>();
    const seen = (id: string | undefined, at: number) => {
      if (id) firstSeen.set(id, Math.min(firstSeen.get(id) ?? Infinity, at));
    };
    for (const row of rows) {
      if (row.kind === "book") seen(row.id, Math.min(row.updatedAt, row.lastReadAt ?? Infinity));
      else for (const id of referencedBooks(row)) seen(id, row.updatedAt);
    }
    const bornWithSource = (book: StudyBook) => (book.id === sourceStudyBookId(book.sourceId) ? 1 : 0);
    for (const books of duplicates) {
      const [kept, ...others] = books.toSorted(
        (a, b) =>
          bornWithSource(a) - bornWithSource(b) ||
          (firstSeen.get(a.id) ?? Infinity) - (firstSeen.get(b.id) ?? Infinity) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
      const next = mergedBook(kept, others);
      keptBooks.set(kept.id, next);
      for (const from of others) {
        moves.set(from.id, { from, kept: next });
        moved.set(from.id, next.id);
      }
    }
  }

  const written = new Map<string, StudyRecord>(rows.map((row) => [row.id, row]));
  for (const row of rows) {
    if (row.kind === "book") {
      if (moves.has(row.id)) remove.push(row.id);
      else if (keptBooks.has(row.id)) put.push(keptBooks.get(row.id) as StudyBook);
      else if (row.attachedToNotebook !== undefined) {
        const { attachedToNotebook: _, ...book } = row;
        put.push(book);
      }
      continue;
    }
    if (!moves.size) continue;
    const next = movedRow(row, moves);
    const draftOf = (row.kind === "document-draft" || row.kind === "ocr-draft") && row.bookId;
    const move = draftOf ? moves.get(draftOf) : undefined;
    if (move && (next.kind === "document-draft" || next.kind === "ocr-draft")) {
      const id = movedDraftId(next, move.from.id, move.kept.id);
      if (id !== row.id) {
        const moved = plain({ ...next, id });
        const existing = written.get(id);
        if (existing) {
          // When the kept book has a draft of its own there, that one stays. This one is left as it
          // was, unless it is the same draft (a backup imported again after the merge).
          if (canonical(existing) === canonical(moved)) remove.push(row.id);
          continue;
        }
        written.set(id, moved);
        remove.push(row.id);
        put.push(moved);
        continue;
      }
    }
    if (JSON.stringify(next) !== JSON.stringify(row)) put.push(plain(next));
  }
  return { put, remove, moved };
}

/** The id a Study picture has once its book is merged (`studyImageId` names the book). */
export function movedStudyImageId(id: string, moved: ReadonlyMap<string, string>) {
  for (const [from, to] of moved) {
    const prefix = studyImagePrefix(from);
    if (id.startsWith(prefix)) return studyImagePrefix(to) + id.slice(prefix.length);
  }
}

/** Whether two stored pictures are the same file. */
export function sameStudyImage(a: { mime: string; data: Uint8Array }, b: { mime: string; data: Uint8Array }) {
  return a.mime === b.mime && a.data.byteLength === b.data.byteLength && a.data.every((byte, at) => byte === b.data[at]);
}

/** The prefix every Study picture id starts with. */
export const studyImageIdPrefix = "study-image:";

/** Why a store refuses a second Study book for one source. */
export const duplicateBookError = "This source already has a Study document.";
