import type { Note, Source } from "@/lib/db/types";
import { selectPassages } from "@/lib/grounding/passages";
import { extractHeadings, sameName } from "@/lib/notes/syntax";
import type { StudyBook, StudyOrigin, StudyThread } from "./records";
import { locateStudyMark, studyTextRevision } from "./text-edits";

export type StudyPassage = {
  origin: StudyOrigin;
  title: string;
  text: string;
};

export type StudyTutorSources = {
  book?: StudyBook;
  books?: readonly StudyBook[];
  notes?: readonly Pick<Note, "id" | "title" | "body">[];
};

type SourcePassage = StudyPassage & { sourceId: string };

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

function rankedPassages(passages: SourcePassage[], query: string, coverSources = false) {
  const ranges = new Map<string, StudyPassage>();
  const sources = new Map<string, Pick<Source, "id" | "title" | "kind">>();
  const size = coverSources ? 1_300 : windowSize;
  const chunks = passages.flatMap((passage, index) => {
    const { sourceId, title } = passage;
    if (!sources.has(sourceId)) sources.set(sourceId, { id: sourceId, title, kind: "text" });
    const chunks: { id: string; sourceId: string; text: string; title: string }[] = [];
    for (let start = 0; start < passage.text.length;) {
      const limit = Math.min(start + size, passage.text.length);
      const boundary = passage.text.lastIndexOf("\n", limit - 1);
      const end = limit !== passage.text.length && boundary > limit - 250 ? boundary + 1 : limit;
      const part = passage.text.slice(start, end);
      const text = part.trim();
      const id = `${index}:${start}`;
      if (text) {
        const offset = start + part.length - part.trimStart().length;
        const origin =
          passage.origin.kind === "book"
            ? { ...passage.origin, offset, length: text.length }
            : passage.origin;
        chunks.push({ id, sourceId, text, title });
        ranges.set(id, { title, origin, text });
      }
      if (end === passage.text.length) break;
      start = end - overlap;
    }
    return chunks;
  });
  return selectPassages({
    sources: [...sources.values()],
    chunks,
    budget: 10_500,
    maxPassages: 8,
    query,
    coverSources,
  }).flatMap(({ chunkId }) => ranges.get(chunkId) ?? []);
}

function notePassages(note: NonNullable<StudyTutorSources["notes"]>[number]): SourcePassage[] {
  const headings = extractHeadings(note.body);
  const ordered = headings.toSorted((a, b) =>
    a.text.localeCompare(b.text, undefined, { sensitivity: "accent" }),
  );
  const duplicates = new Set<number>();
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1];
    const next = ordered[index];
    if (sameName(previous.text, next.text)) {
      duplicates.add(previous.from);
      duplicates.add(next.from);
    }
  }
  const anchors = [{ from: 0, text: "" }, ...headings];
  return anchors.flatMap(({ from, text }, index) => {
    const end = anchors[index + 1]?.from ?? note.body.length;
    const body = note.body.slice(from, end);
    if (!body.trim()) return [];
    const heading = text && !duplicates.has(from) ? text : undefined;
    return [
      {
        sourceId: `note:${note.id}`,
        origin: { kind: "note", noteId: note.id, heading },
        title: text ? `${note.title} · ${text}` : note.title,
        text: body,
      },
    ];
  });
}

function bookPassages(book: StudyBook): SourcePassage[] {
  const revision = studyTextRevision(book);
  return book.sections.map((section, index) => ({
    sourceId: `book:${book.id}`,
    origin: { kind: "book", bookId: book.id, section: index, revision },
    title: section.title === book.title ? book.title : `${book.title} · ${section.title}`,
    text: section.text,
  }));
}

export function passagesFor(
  thread: StudyThread,
  { book, books = [], notes = [] }: StudyTutorSources,
  input: string,
): StudyPassage[] {
  if (thread.scope === "notes" || thread.scope === "materials") {
    const originNotes = new Set(thread.noteIds);
    const passages = notes.filter(({ id }) => originNotes.has(id)).flatMap(notePassages);
    if (thread.scope === "materials") {
      const originBooks = new Set(thread.bookIds);
      passages.push(...books.filter(({ id }) => originBooks.has(id)).flatMap(bookPassages));
    }
    return rankedPassages(passages, studyQuery(input, thread.messages), true);
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
  const sections = bookPassages(book);
  return rankedPassages(
    thread.scope === "chapter" ? [sections[position]] : sections,
    studyQuery(input, thread.messages),
  );
}
