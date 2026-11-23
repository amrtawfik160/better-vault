import { originHref } from "./links";
import { tutorBookOrigin } from "./passages";
import type { StudyBook, StudyThread } from "./records";

/** The spoken exercises the Practice tab starts. Book questions and general chats are conversations. */
export const practiceGoals = [
  "teach-back",
  "meeting-simulation",
  "technical-interview",
  "language",
] as const satisfies readonly StudyThread["goal"][];
export type PracticeGoal = (typeof practiceGoals)[number];

export function isPracticeThread({ goal }: Pick<StudyThread, "goal">) {
  return goal !== "book" && goal !== "general";
}

/** The exercise's name to show beside a practice thread, unless its title already starts with it. */
export function goalLabel(thread: Pick<StudyThread, "goal" | "title">, label: string) {
  return isPracticeThread(thread) && !thread.title.startsWith(label) ? label : undefined;
}

/** A question thread about one document, which opens beside it in the reader's Ask panel. */
export function threadReaderBook(thread: StudyThread, books: readonly StudyBook[]) {
  if (thread.goal !== "book" || !thread.bookId) return;
  return books.find(({ id }) => id === thread.bookId);
}

/** The reader at the thread's place in the document, with the thread open in the Ask panel. */
export function readerThreadHref(thread: StudyThread, book: StudyBook) {
  const [path, query] = originHref(tutorBookOrigin(thread, book)).split("?", 2);
  const params = new URLSearchParams(query);
  params.set("readerTutor", thread.id);
  return `${path}?${params}`;
}
