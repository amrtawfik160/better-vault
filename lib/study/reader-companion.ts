import type { StudyOrigin, StudyPractice } from "./records";
import { textLines } from "@/lib/text/direction";

/**
 * The reader's companion (Ask · Practise · Make) and its Contents panel: the
 * rules that decide what they show, kept apart from the components so they
 * can be tested.
 */

/** What the reader calls the part on screen: a PDF's page, another document's chapter, or the document when it has one part. */
export type ReaderPart = { kind: "page" | "chapter"; number: number } | { kind: "document" };

export function readerPart(book: { format: "pdf" | "epub" | "text"; sections: readonly unknown[] }, index: number): ReaderPart {
  if (book.sections.length <= 1) return { kind: "document" };
  return { kind: book.format === "pdf" ? "page" : "chapter", number: Math.min(Math.max(0, index), book.sections.length - 1) + 1 };
}

/** The exercises the Practise tab offers. Explain it back and Questions are written sessions. */
export type ReaderExercise = "teach" | "questions" | "roleplay";
export const readerExercises = ["teach", "questions", "roleplay"] as const satisfies readonly ReaderExercise[];

/** How the companion is laid out: a column beside the text, an overlay from the inline end, or the whole screen. */
export type ReaderCompanionLayout = "column" | "overlay" | "sheet";

/** The companion is a column from 1280px, an overlay from 768px, and full screen on phones. */
export const readerColumnQuery = "(min-width: 1280px)";
export const readerOverlayQuery = "(min-width: 768px)";

export function readerCompanionLayout(column: boolean, overlay: boolean): ReaderCompanionLayout {
  if (column) return "column";
  return overlay ? "overlay" : "sheet";
}

const sessionMode = (session: StudyPractice) => session.mode ?? "questions";

/** Whether an origin is this document, or the given part of it (a session on the whole document covers every part). */
function coversBook(origin: StudyOrigin, bookId: string, section?: number) {
  if (origin.kind !== "book" || origin.bookId !== bookId) return false;
  return section === undefined || origin.section === undefined || origin.section === section;
}

/**
 * The exercise the Practise tab starts with: Explain it back the first time
 * for this material, Questions once it has been explained back.
 */
export function readerDefaultExercise(
  sessions: readonly StudyPractice[],
  bookId: string,
  section?: number,
): Extract<ReaderExercise, "teach" | "questions"> {
  const explained = sessions.some(
    (session) =>
      sessionMode(session) === "teach" &&
      session.material.origins.some((origin) => coversBook(origin, bookId, section)),
  );
  return explained ? "questions" : "teach";
}

/** This document's written practice sessions, most recent first. */
export function readerPracticeResults(sessions: readonly StudyPractice[], bookId: string, limit = 3) {
  return sessions
    .filter((session) => session.material.origins.some((origin) => coversBook(origin, bookId)))
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

/** What the Practice page is asked to open from a link: an exercise, and for written ones the material. */
export type PracticeEntry = { exercise: ReaderExercise; bookId?: string; section?: number };

export const practiceEntryParams = ["exercise", "book", "section"] as const;

/**
 * Reads `exercise=teach|questions|roleplay&book=<id>&section=<n>` (section
 * from 0, as the reader counts). Unknown exercises are ignored.
 */
export function practiceEntry(params: URLSearchParams): PracticeEntry | null {
  const exercise = readerExercises.find((value) => value === params.get("exercise"));
  if (!exercise) return null;
  const bookId = params.get("book")?.trim() || undefined;
  const raw = params.get("section");
  const section = raw !== null && /^\d+$/.test(raw) ? Number(raw) : undefined;
  if (exercise === "roleplay" || !bookId) return { exercise };
  return section === undefined ? { exercise, bookId } : { exercise, bookId, section };
}

/** The query that opens the Practice page on an exercise, the reverse of `practiceEntry`. */
export function practiceEntryQuery(entry: PracticeEntry): Record<string, string | undefined> {
  return {
    exercise: entry.exercise,
    book: entry.exercise === "roleplay" ? undefined : entry.bookId,
    section: entry.exercise === "roleplay" || entry.section === undefined ? undefined : String(entry.section),
  };
}

/**
 * The first-open strip shows once per new document until it is dismissed.
 * `stored` is what was remembered for the document: nothing yet, `pending`
 * (shown, not dismissed) or `done`. A document read before this visit is not new.
 */
export function firstOpenStrip(stored: string | null, readBefore: boolean): { show: boolean; remember?: "pending" } {
  if (stored === "done") return { show: false };
  if (stored === "pending") return { show: true };
  return readBefore ? { show: false } : { show: true, remember: "pending" };
}

/**
 * Where "You left off here" goes in plain text: the start of the line that
 * holds the saved position. Nothing at the very start, where there is
 * nothing to mark.
 */
export function leftOffLineStart(text: string, offset: number): number | undefined {
  if (offset <= 0 || offset >= text.length) return;
  let start = 0;
  for (const line of textLines(text)) {
    const end = start + line.length;
    if (offset < end) return start > 0 ? start : undefined;
    start = end;
  }
}
