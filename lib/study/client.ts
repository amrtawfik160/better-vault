import { activeModel, credentialsFor, getSettings } from "@/lib/db/settings";
import { studyAnswerSchema, type StudyAction } from "./ai";
import type { StudyBook, StudyThread } from "./records";

export type StudyPassage = {
  bookId: string;
  section: number;
  title: string;
  text: string;
};

export function passagesFor(
  thread: StudyThread,
  book: StudyBook | undefined,
  input: string,
): StudyPassage[] {
  if (!book || thread.scope === "general" || thread.scope === "notes") return [];
  const position = Math.min(thread.section ?? book.section, book.sections.length - 1);
  if (thread.scope === "passage" && thread.quote) {
    return [
      {
        bookId: book.id,
        section: position,
        title: book.sections[position].title,
        text: thread.quote,
      },
    ];
  }
  if (thread.scope !== "book") {
    const current = book.sections[position];
    return [{ bookId: book.id, section: position, title: current.title, text: current.text }];
  }
  const terms = input.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return book.sections
    .map((section, index) => {
      const text = section.text.toLowerCase();
      const locations = terms.map((term) => text.indexOf(term)).filter((at) => at >= 0);
      const start = locations.length ? Math.max(0, Math.min(...locations) - 300) : 0;
      return {
        bookId: book.id,
        section: index,
        title: section.title,
        text: section.text.slice(start, start + 4500),
        score: locations.length,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

export async function askStudyModel(
  action: StudyAction,
  input: string,
  passages: Pick<StudyPassage, "title" | "text">[] = [],
  thread?: StudyThread,
  signal?: AbortSignal,
) {
  const settings = await getSettings();
  const model = activeModel(settings);
  if (!model) throw new Error("Connect or choose an AI model in Settings to continue.");
  const response = await fetch("/api/study", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action,
      input,
      model,
      credentials: credentialsFor(settings, model.provider),
      passages: passages
        .slice(0, 8)
        .map(({ title, text }) => ({ title: title.slice(0, 500), text: text.slice(0, 12_000) })),
      history: thread?.messages
        .slice(-16)
        .map(({ role, text }) => ({ role, text: text.slice(0, 12_000) })),
      goal: thread?.goal,
      correct: thread?.corrections === "live",
    }),
    signal,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(typeof result?.error === "string" ? result.error : "Study request failed.");
  return studyAnswerSchema.parse(result);
}
