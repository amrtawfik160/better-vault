import { z } from "zod";
import { routes } from "@/lib/routes";
import { weakStudyCards } from "./recall";
import type { StudyBook, StudyRecord, StudyRecordOf } from "./records";
import { matchesStudyReport } from "./reports";

const snapshotSchema = z.object({
  revealed: z.string(),
  rated: z.number().int().nonnegative(),
  practiced: z.array(z.string()).nullable(),
  position: z.object({ id: z.string(), dueAt: z.number() }).optional(),
});
const savedSessions = z.array(z.tuple([z.string(), snapshotSchema]));
const storageKey = "better-vault:study-review-sessions";
const directKey = `${storageKey}:direct`;
const directSession = z.tuple([z.string(), z.string().min(1).max(80)]);
export type ReviewSnapshot = z.infer<typeof snapshotSchema>;

const selectionSchema = z.object({
  studyReviewSession: z.string().min(1).max(80).optional(),
  studyReviewIds: z.array(z.string()).optional(),
  studyReviewVault: z.string().optional(),
});
const returnSchema = z.object({
  studyReturn: z.object({
    path: z.string(),
    state: selectionSchema.extend({ studyReviewSession: z.string().min(1).max(80) }),
  }),
});
const resumeSchema = returnSchema.shape.studyReturn.extend({ snapshot: snapshotSchema });
const resumePrefix = "better-vault:study-review:";
type ReviewDestination = z.infer<typeof returnSchema>["studyReturn"];
type ReviewItem = StudyRecordOf<"card" | "highlight">;

function isReviewPath(href: string) {
  const [path, query] = href.split("?", 2);
  const params = new URLSearchParams(query);
  return path === routes.home && params.get("view") === "study" && params.get("tab") === "review";
}

export function reviewSelection(state: unknown) {
  const parsed = selectionSchema.safeParse(state);
  return parsed.success ? parsed.data : undefined;
}

export function reviewReturnState(state: unknown) {
  const parsed = returnSchema.safeParse(state);
  if (parsed.success && isReviewPath(parsed.data.studyReturn.path)) return parsed.data;
}

export function studyCardsInScope(
  cards: StudyRecordOf<"card">[],
  params: URLSearchParams,
  book: StudyBook | undefined,
  threadId: string | null,
) {
  const fromReport = params.get("fromReport");
  const outputId = params.get("output");
  const cardId = params.get("card");
  const notebookId = params.get("notebook");
  return cards.filter(
    (card) =>
      (!book ||
        (card.origin?.kind === "book"
          ? card.origin.bookId === book.id
          : card.notebookId === book.notebookId)) &&
      (!notebookId || card.notebookId === notebookId) &&
      (!outputId || (card.origin?.kind === "studio" && card.origin.outputId === outputId)) &&
      (!fromReport || matchesStudyReport(card.origin, threadId, fromReport)) &&
      (!cardId || card.id === cardId),
  );
}

export function reviewCollection(
  rows: StudyRecord[],
  params: URLSearchParams,
  selection?: string[],
) {
  const bookId = params.get("book");
  const book = rows.find((row): row is StudyBook => row.kind === "book" && row.id === bookId);
  if (bookId && !book) return [];
  const threadId = params.get("thread");
  const reviewingHighlights = params.get("kind") === "highlights";
  const vocabulary =
    params.get("kind") === "vocabulary"
      ? new Set(rows.filter((row) => row.kind === "word").map(({ id }) => id))
      : undefined;
  const ids =
    !reviewingHighlights && params.get("mode") === "weak"
      ? new Set(weakStudyCards(rows).map(({ card }) => card.id))
      : selection
        ? new Set(selection)
        : undefined;
  const items = reviewingHighlights
    ? rows.filter(
        (row): row is StudyRecordOf<"highlight"> =>
          row.kind === "highlight" && (!book || row.bookId === book.id),
      )
    : studyCardsInScope(
        rows.filter(
          (row): row is StudyRecordOf<"card"> =>
            row.kind === "card" &&
            (!vocabulary || (row.origin?.kind === "word" && vocabulary.has(row.origin.wordId))),
        ),
        params,
        book,
        rows.some((row) => row.kind === "thread" && row.id === threadId) ? threadId : null,
      );
  return ids ? items.filter(({ id }) => ids.has(id)) : items;
}

export function reviewQueue(items: ReviewItem[], practiced: string[] | null, now: number) {
  if (practiced) {
    const completed = new Set(practiced);
    return items.filter(({ id }) => !completed.has(id));
  }
  return items
    .filter(({ schedule }) => schedule.dueAt <= now)
    .toSorted((a, b) => a.schedule.dueAt - b.schedule.dueAt);
}

function readSessions(): z.infer<typeof savedSessions> {
  try {
    const parsed = savedSessions.safeParse(JSON.parse(sessionStorage.getItem(storageKey) ?? "[]"));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function loadReviewSession(key: string) {
  return readSessions().find(([id]) => id === key)?.[1];
}

export function directReviewSession(path: string, id: string) {
  try {
    const parsed = directSession.safeParse(JSON.parse(sessionStorage.getItem(directKey) ?? "null"));
    if (parsed.success && parsed.data[0] === path) return parsed.data[1];
    sessionStorage.setItem(directKey, JSON.stringify([path, id]));
  } catch {
    // The generated ID can still identify this review until the tab closes.
  }
  return id;
}

export function saveReviewSession(key: string, snapshot: ReviewSnapshot) {
  try {
    const recent = readSessions()
      .filter(([id]) => id !== key)
      .slice(0, 11);
    sessionStorage.setItem(storageKey, JSON.stringify([[key, snapshot], ...recent]));
  } catch {
    // Review grades are in the database even when this tab cannot retain its UI.
  }
}

export function savedReview(vaultId: string) {
  try {
    const parsed = resumeSchema.safeParse(
      JSON.parse(localStorage.getItem(resumePrefix + vaultId) ?? "null"),
    );
    if (
      parsed.success &&
      parsed.data.state.studyReviewVault === vaultId &&
      isReviewPath(parsed.data.path)
    )
      return parsed.data;
  } catch {
    // A browser can block local storage while still allowing tab history.
  }
}

function sameReview(current: ReviewDestination | undefined, target: ReviewDestination) {
  return (
    current?.path === target.path &&
    current.state.studyReviewSession === target.state.studyReviewSession
  );
}

export function resumeReviewSnapshot(vaultId: string, destination: ReviewDestination) {
  const current = savedReview(vaultId);
  if (sameReview(current, destination)) return current?.snapshot;
}

export function saveReviewCheckpoint(
  vaultId: string,
  destination: ReviewDestination,
  snapshot: ReviewSnapshot,
) {
  try {
    if (snapshot.position) {
      localStorage.setItem(resumePrefix + vaultId, JSON.stringify({ ...destination, snapshot }));
    } else if (sameReview(savedReview(vaultId), destination)) {
      clearReviewCheckpoint(vaultId);
    }
  } catch {
    // The database still records completed grades if local storage is unavailable.
  }
}

export function clearReviewCheckpoint(vaultId: string) {
  try {
    localStorage.removeItem(resumePrefix + vaultId);
  } catch {
    // Local storage may be unavailable.
  }
}

export function clearAllReviewCheckpoints() {
  try {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith(resumePrefix)) localStorage.removeItem(key);
    }
  } catch {
    // Local storage may be unavailable.
  }
  try {
    sessionStorage.removeItem(storageKey);
    sessionStorage.removeItem(directKey);
  } catch {
    // Tab storage may be unavailable.
  }
}
