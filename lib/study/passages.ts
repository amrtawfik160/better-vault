import type { Note, Source } from "@/lib/db/types";
import { selectPassages } from "@/lib/grounding/passages";
import type { StudyBook, StudyOrigin, StudyThread } from "./records";
import { locateStudyMark, studyTextRevision } from "./text-edits";

export type StudyPassage = {
  origin: StudyOrigin;
  title: string;
  text: string;
};

const windowSize = 1500;
const overlap = 180;
const filler = new Set(
  "a an and are as at be can could did do does explain for from give how i in is it main me of on or please should show tell than that the them their these they this those to was were what when where which who why will with would you".split(
    " ",
  ),
);

export function tutorBookOrigin(
  thread: StudyThread,
  book: StudyBook,
): Extract<StudyOrigin, { kind: "book" }> & { section: number } {
  const section = Math.min(thread.section ?? book.section, book.sections.length - 1);
  const origin = { kind: "book" as const, bookId: book.id, section };
  if (thread.scope !== "passage" || !thread.quote) return origin;
  const length = thread.quote.length;
  if (thread.offset !== undefined)
    return { ...origin, offset: thread.offset, length, revision: thread.revision };
  const revision = studyTextRevision(book);
  const offset = locateStudyMark(book, { section, quote: thread.quote, offset: 0, revision });
  return offset < 0 ? origin : { ...origin, offset, length, revision };
}

function topicTerms(text: string) {
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((term) => !filler.has(term))
    .slice(0, 24);
}

function studyQuery(input: string, history: StudyThread["messages"]) {
  const terms = topicTerms(input);
  if (terms.length <= 2 || /\b(that|those|this|it|they|them)\b/i.test(input)) {
    const previous = history.findLast(({ role }) => role === "user");
    if (previous) return [...new Set([...terms, ...topicTerms(previous.text)])].join(" ");
  }
  return terms.join(" ");
}

function rankedPassages(passages: StudyPassage[], query: string) {
  const ranges = new Map<string, StudyPassage>();
  const sources: Pick<Source, "id" | "title" | "kind">[] = passages.map((passage, index) => ({
    id: String(index),
    title: passage.title,
    kind: "text",
  }));
  const chunks = passages.flatMap((passage, index) => {
    const sourceId = String(index);
    const chunks: { id: string; sourceId: string; text: string }[] = [];
    for (let start = 0; start < passage.text.length;) {
      const limit = Math.min(start + windowSize, passage.text.length);
      const boundary = passage.text.lastIndexOf("\n", limit - 1);
      const end = limit !== passage.text.length && boundary > limit - 250 ? boundary + 1 : limit;
      const part = passage.text.slice(start, end);
      const text = part.trim();
      const id = `${sourceId}:${start}`;
      if (text) {
        const offset = start + part.length - part.trimStart().length;
        const origin =
          passage.origin.kind === "book"
            ? { ...passage.origin, offset, length: text.length }
            : passage.origin;
        chunks.push({ id, sourceId, text });
        ranges.set(id, { ...passage, origin, text });
      }
      if (end === passage.text.length) break;
      start = end - overlap;
    }
    return chunks;
  });
  return selectPassages({ sources, chunks, budget: 10_500, maxPassages: 8, query }).flatMap(
    ({ chunkId }) => ranges.get(chunkId) ?? [],
  );
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
      studyQuery(input, thread.messages),
    );
  }
  if (thread.scope === "general" || !book) return [];
  const origin = tutorBookOrigin(thread, book);
  const { section: position } = origin;
  if (thread.scope === "passage" && thread.quote) {
    return [
      {
        origin,
        title: book.sections[position].title,
        text: thread.quote,
      },
    ];
  }
  const sections = book.sections.map((section, index): StudyPassage => ({
    origin: { kind: "book", bookId: book.id, section: index, revision: studyTextRevision(book) },
    title: section.title,
    text: section.text,
  }));
  return rankedPassages(
    thread.scope === "chapter" ? [sections[position]] : sections,
    studyQuery(input, thread.messages),
  );
}
