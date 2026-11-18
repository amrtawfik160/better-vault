import { activeModel, credentialsFor, getSettings } from "@/lib/db/settings";
import { studyAnswerSchema, type StudyAction } from "./ai";
import { locateStudyQuote } from "./locators";
import type { Note } from "@/lib/db/types";
import type { StudyBook, StudyOrigin, StudyThread } from "./records";

export type StudyPassage = {
  origin: StudyOrigin;
  title: string;
  text: string;
};

function rankedPassages(passages: StudyPassage[], input: string) {
  const terms = [...new Set(input.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])];
  return passages
    .map((passage) => {
      const lower = passage.text.toLowerCase();
      const matched = terms.map((term) => lower.indexOf(term)).filter((at) => at >= 0);
      const start = matched.length ? Math.max(0, Math.min(...matched) - 300) : 0;
      const text = passage.text.slice(start, start + 4500);
      const origin =
        passage.origin.kind === "book"
          ? { ...passage.origin, offset: start, length: text.length }
          : passage.origin;
      return { ...passage, origin, text, score: matched.length };
    })
    .filter(({ text }) => text.trim())
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

export function passagesFor(
  thread: StudyThread,
  book: StudyBook | undefined,
  input: string,
  notes: Pick<Note, "id" | "title" | "body">[] = [],
): StudyPassage[] {
  if (thread.scope === "notes") {
    const originNotes = new Set(thread.noteIds);
    return rankedPassages(
      notes
        .filter((note) => originNotes.has(note.id))
        .map((note) => ({
          origin: { kind: "note", noteId: note.id },
          title: note.title,
          text: note.body,
        })),
      input,
    );
  }
  if (thread.scope === "general" || !book) return [];
  const position = Math.min(thread.section ?? book.section, book.sections.length - 1);
  if (thread.scope === "passage" && thread.quote) {
    const section = book.sections[position];
    const offset = locateStudyQuote(section.text, thread.quote, thread.offset);
    return [
      {
        origin: {
          kind: "book",
          bookId: book.id,
          section: position,
          ...(offset >= 0 ? { offset, length: thread.quote.length } : {}),
        },
        title: section.title,
        text: thread.quote,
      },
    ];
  }
  const sections = book.sections.map((section, index): StudyPassage => ({
    origin: { kind: "book", bookId: book.id, section: index },
    title: section.title,
    text: section.text,
  }));
  return rankedPassages(thread.scope === "chapter" ? [sections[position]] : sections, input);
}

export async function askStudyModel({
  action,
  input,
  passages = [],
  thread,
  signal,
  cardCount,
}: {
  action: StudyAction;
  input: string;
  passages?: Pick<StudyPassage, "title" | "text">[];
  thread?: StudyThread;
  signal?: AbortSignal;
  cardCount?: number;
}) {
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
      cardCount,
      correctionMode: thread?.corrections ?? "off",
      practiceLanguage: thread?.practiceLanguage,
    }),
    signal,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(typeof result?.error === "string" ? result.error : "Study request failed.");
  return studyAnswerSchema.parse(result);
}
