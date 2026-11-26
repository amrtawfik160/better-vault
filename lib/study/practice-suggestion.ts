import type { StudyBook, StudyPractice } from "./records";
import { analysedTeachRounds } from "./teach";
import { practiceSessionStats } from "./writing-practice";

/** The written exercises: answer questions, or explain it back. */
export type WrittenMode = NonNullable<StudyPractice["mode"]>;

export type PracticeSuggestion =
  | { kind: "resume"; session: StudyPractice; answered: number; total: number }
  | {
      kind: "start";
      mode: WrittenMode;
      book: StudyBook;
      /** The chapter being read, when the document has chapters. */
      section?: number;
      /** When the reader last had it open. */
      readAt: number;
    };

const DAY = 24 * 60 * 60 * 1000;
/** An unfinished session older than this is no longer offered. */
const RESUME_WITHIN = 7 * DAY;
/** Reading older than this is not "what you just read". */
const READ_WITHIN = 14 * DAY;

const modeOf = (session: StudyPractice): WrittenMode => session.mode ?? "questions";

/** Whether a session was left before its end: questions unanswered, or nothing explained yet. */
export function unfinishedPractice(session: StudyPractice) {
  if (modeOf(session) === "teach") return analysedTeachRounds(session).length === 0;
  const { answered, total } = practiceSessionStats(session);
  return total > 0 && answered < total;
}

const practisedBook = (session: StudyPractice, bookId: string) =>
  session.material.origins.some((origin) => origin.kind === "book" && origin.bookId === bookId);

/**
 * The Practice page's one suggestion, by the same rule as Today, kept to
 * practice: finish what was left, else practise what was read last.
 * Explaining it back comes first for material never explained; questions after.
 */
export function practiceSuggestion({
  books,
  sessions,
  now,
}: {
  books: readonly StudyBook[];
  sessions: readonly StudyPractice[];
  now: number;
}): PracticeSuggestion | null {
  const left = sessions
    .filter((session) => now - session.updatedAt <= RESUME_WITHIN && unfinishedPractice(session))
    .toSorted((a, b) => b.updatedAt - a.updatedAt)[0];
  if (left) {
    const { answered, total } = practiceSessionStats(left);
    return { kind: "resume", session: left, answered, total };
  }
  const book = books
    .filter(
      (each) =>
        each.lastReadAt !== undefined &&
        now - each.lastReadAt <= READ_WITHIN &&
        each.sections.some(({ text }) => text.trim()),
    )
    .toSorted((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0];
  if (!book?.lastReadAt) return null;
  const explained = sessions.some(
    (session) => modeOf(session) === "teach" && practisedBook(session, book.id),
  );
  return {
    kind: "start",
    mode: explained ? "questions" : "teach",
    book,
    section: book.sections.length > 1 ? book.section : undefined,
    readAt: book.lastReadAt,
  };
}
