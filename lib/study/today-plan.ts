import type { StudyBook, StudyPractice } from "./records";
import { unfinishedPractice, type WrittenMode } from "./practice-suggestion";
import { studyReadingProgress } from "./reading-progress";
import { analysedTeachRounds } from "./teach";
import { practiceSessionStats } from "./writing-practice";

const DAY = 24 * 60 * 60 * 1000;
/** An unfinished written session older than this is no longer offered. */
const RESUME_WITHIN = 7 * DAY;
/** "Read recently" for practising: the last 48 hours. */
const PRACTISE_WITHIN = 2 * DAY;

/**
 * One thing Today can offer. The order of the kinds is the rule:
 * resume an unfinished session, practise what was read in the last 48 hours,
 * due cards, continue reading, start new material.
 */
export type TodayStep =
  | { id: string; kind: "resume-practice"; session: StudyPractice; answered: number; total: number }
  | { id: string; kind: "resume-review"; due: number }
  | { id: string; kind: "practise"; book: StudyBook; mode: WrittenMode }
  | { id: string; kind: "cards"; due: number }
  | { id: string; kind: "read"; book: StudyBook }
  | { id: string; kind: "new"; book: StudyBook };

export type TodayState =
  /** Nothing in the vault yet: invite the first material. */
  | "first-time"
  /** Something was done today and nothing urgent is left. */
  | "done"
  /** Material exists but nothing is worth offering. */
  | "nothing"
  /** There is a next step. */
  | "step";

export type TodayPlan = {
  state: TodayState;
  /** Every offered candidate in rule order, minus those hidden for today. */
  steps: TodayStep[];
  next: TodayStep | undefined;
  /** At most three of the steps after the next one. */
  then: TodayStep[];
  /** Steps the reader hid with "Not today", in rule order. */
  hidden: TodayStep[];
};

export type TodayPlanInput = {
  books: readonly StudyBook[];
  sessions: readonly StudyPractice[];
  now: number;
  /** Cards, highlights and words due now. */
  due: number;
  /** A paused review that can still be resumed. */
  reviewPaused: boolean;
  /** Whether any study was done today. */
  doneToday: boolean;
  /** Step ids hidden until tomorrow. */
  skipped: readonly string[];
  progressOf?: (book: StudyBook) => number;
};

const hasText = (book: StudyBook) => book.sections.some(({ text }) => text.trim());
const modeOf = (session: StudyPractice): WrittenMode => session.mode ?? "questions";
const newest = (a: StudyBook, b: StudyBook) =>
  (b.lastReadAt ?? b.updatedAt) - (a.lastReadAt ?? a.updatedAt);

/** How far a written session got, for the resume step. */
export const todayResumeStats = (session: StudyPractice) =>
  modeOf(session) === "teach"
    ? { answered: analysedTeachRounds(session).length, total: 1 }
    : practiceSessionStats(session);

/** Today's candidates, in the transparent rule's order. */
export function todayCandidates({
  books,
  sessions,
  now,
  due,
  reviewPaused,
  progressOf = studyReadingProgress,
}: Pick<
  TodayPlanInput,
  "books" | "sessions" | "now" | "due" | "reviewPaused" | "progressOf"
>): TodayStep[] {
  const steps: TodayStep[] = [];

  const left = sessions
    .filter((session) => now - session.updatedAt <= RESUME_WITHIN && unfinishedPractice(session))
    .toSorted((a, b) => b.updatedAt - a.updatedAt)[0];
  if (left) {
    const { answered, total } = todayResumeStats(left);
    steps.push({
      id: `resume-practice:${left.id}`,
      kind: "resume-practice",
      session: left,
      answered,
      total,
    });
  }
  if (reviewPaused) steps.push({ id: "resume-review", kind: "resume-review", due });

  const recent = books
    .filter(
      (book) =>
        book.lastReadAt !== undefined && now - book.lastReadAt <= PRACTISE_WITHIN && hasText(book),
    )
    .toSorted(newest)[0];
  if (recent) {
    const explained = sessions.some(
      (session) =>
        modeOf(session) === "teach" &&
        session.material.origins.some(
          (origin) => origin.kind === "book" && origin.bookId === recent.id,
        ),
    );
    steps.push({
      id: `practise:${recent.id}`,
      kind: "practise",
      book: recent,
      mode: explained ? "questions" : "teach",
    });
  }

  if (due > 0 && !reviewPaused) steps.push({ id: "cards", kind: "cards", due });

  const reading = books
    .filter((book) => book.lastReadAt !== undefined && hasText(book) && progressOf(book) < 1)
    .toSorted(newest)[0];
  if (reading) steps.push({ id: `read:${reading.id}`, kind: "read", book: reading });

  const fresh = books
    .filter(
      (book) =>
        book.lastReadAt === undefined && !book.readingPlace && book.section === 0 && hasText(book),
    )
    .toSorted(newest)[0];
  if (fresh) steps.push({ id: `new:${fresh.id}`, kind: "new", book: fresh });

  return steps;
}

/** What Today shows: the next step, what comes after it, and which state the page is in. */
export function todayPlan(input: TodayPlanInput): TodayPlan {
  const skipped = new Set(input.skipped);
  const all = todayCandidates(input);
  const steps = all.filter(({ id }) => !skipped.has(id));
  const hidden = all.filter(({ id }) => skipped.has(id));
  // After something was done, only unfinished work or due cards keep the plan open.
  const pending = steps.some(
    ({ kind }) => kind === "resume-practice" || kind === "resume-review" || kind === "cards",
  );
  let state: TodayState;
  if (!input.books.length && !all.length) state = "first-time";
  else if (input.doneToday && !pending) state = "done";
  else if (!steps.length) state = "nothing";
  else state = "step";
  const next = state === "step" ? steps[0] : undefined;
  return { state, steps, next, then: steps.slice(next ? 1 : 0, next ? 4 : 3), hidden };
}
