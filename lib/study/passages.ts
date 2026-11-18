import type { Chunk, Note, Source } from "@/lib/db/types";
import { citedNumbers, selectPassages } from "@/lib/grounding/passages";
import { extractHeadings, sameName } from "@/lib/notes/syntax";
import { activeStudyCard, recentPracticeCards, selectedStudyCards } from "./recall";
import { originHref, studyCitationOrigin, studyHighlightOrigin } from "./links";
import type { StudyBook, StudyOrigin, StudyRecordOf, StudyThread } from "./records";
import { quizChoicesText } from "./quiz-cards";
import { locateStudyMark, resolveStudyRange, studyTextRevision } from "./text-edits";
import { studyTextWindows } from "./text-windows";

export type StudyPassage = {
  origin: StudyOrigin;
  title: string;
  text: string;
  previousCitations?: number[];
};

export type StudyDraftPassage = StudyPassage & { image?: string };

export type StudyTutorSources = {
  book?: StudyBook;
  documentImage?: string;
  books?: readonly StudyBook[];
  notes?: readonly Pick<Note, "id" | "title" | "body">[];
  notebookSources?: readonly (Pick<Source, "id" | "title" | "notebookId"> & {
    chunks: readonly Pick<Chunk, "id" | "text">[];
  })[];
  cards?: readonly StudyRecordOf<"card">[];
  cardEvidence?: ReadonlyMap<string, StudyPassage[]>;
  highlights?: readonly { highlight: StudyRecordOf<"highlight">; book: StudyBook }[];
};

type SourcePassage = StudyPassage & { sourceId: string };

export const cardEvidenceLimit = 1400;

const filler = new Set(
  "a an and are as at be can could did do does explain for from give how i in is it main me of on or please should show tell than that the them their these they this those to was were what when where which who why will with would you".split(
    " ",
  ),
);
const followUpTerms = new Set(
  "again analogy another clarify detail details differently elaborate example examples explain further illustrate more previous rephrase repeat simpler summarize".split(
    " ",
  ),
);

export function tutorBookOrigin(
  thread: StudyThread,
  book: StudyBook,
): Extract<StudyOrigin, { kind: "book" }> & { section: number } {
  const section = Math.min(thread.section ?? book.section, book.sections.length - 1);
  const origin = { kind: "book" as const, bookId: book.id, section };
  if (thread.scope === "image") return { ...origin, visual: thread.imageContext?.anchor };
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

function studyQuery(input: string, thread: StudyThread, purpose: "chat" | "report") {
  const terms = topicTerms(input);
  const exerciseTerms = topicTerms(thread.followUp?.text ?? "");
  const latest = thread.messages.at(-1);
  const citations =
    purpose === "chat" && latest?.role === "assistant" ? (latest.citations ?? []) : [];
  const explicit = citedNumbers(input).flatMap(
    (number) => citations.find(({ index }) => index === number) ?? [],
  );
  const followUp =
    explicit.length > 0 ||
    /\b(that|those|this|it|they|them)\b/iu.test(input) ||
    (terms.length <= 2 && terms.every((term) => followUpTerms.has(term)));
  if (followUp) {
    const previous = thread.messages.findLast(({ role }) => role === "user");
    return {
      query: [...new Set([...terms, ...exerciseTerms, ...topicTerms(previous?.text ?? "")])].join(
        " ",
      ),
      anchors: (explicit.length ? explicit.slice(0, 4) : citations.slice(0, 2)).map((citation) => ({
        index: citation.index,
        origin: studyCitationOrigin(citation),
      })),
      explicit: explicit.length > 0,
    };
  }
  return {
    query: [...new Set([...terms, ...exerciseTerms])].join(" "),
    anchors: [],
    explicit: false,
  };
}

function matchingChunkLength(candidate: StudyOrigin, anchor: StudyOrigin) {
  if (candidate.kind === "note" && anchor.kind === "note") {
    return Number(candidate.noteId === anchor.noteId && candidate.heading === anchor.heading);
  }
  if (candidate.kind === "source" && anchor.kind === "source") {
    return Number(
      candidate.notebookId === anchor.notebookId &&
        candidate.sourceId === anchor.sourceId &&
        candidate.chunkId === anchor.chunkId,
    );
  }
  if (
    candidate.kind !== "book" ||
    anchor.kind !== "book" ||
    candidate.bookId !== anchor.bookId ||
    candidate.section !== anchor.section ||
    candidate.highlightId !== anchor.highlightId
  )
    return 0;
  if (anchor.highlightId || anchor.offset === undefined || anchor.length === undefined) return 1;
  if (candidate.offset === undefined || candidate.length === undefined) return 0;
  return Math.max(
    0,
    Math.min(candidate.offset + candidate.length, anchor.offset + anchor.length) -
      Math.max(candidate.offset, anchor.offset),
  );
}

function previousCitationChunks(
  ranges: ReadonlyMap<string, StudyPassage>,
  anchors: readonly { index: number; origin: StudyOrigin }[],
  books: readonly StudyBook[],
) {
  const prioritized = new Map<string, number[]>();
  for (const { index, origin } of anchors) {
    let anchor = origin;
    if (
      origin.kind === "book" &&
      !origin.highlightId &&
      origin.offset !== undefined &&
      origin.length !== undefined
    ) {
      const book = books.find(({ id }) => id === origin.bookId);
      if (!book || origin.section === undefined) continue;
      const current = resolveStudyRange(book, origin.section, {
        offset: origin.offset,
        length: origin.length,
        revision: origin.revision,
      });
      if (!current) continue;
      anchor = { ...origin, ...current };
    }
    let best: string | undefined;
    let matched = 0;
    for (const [id, passage] of ranges) {
      const size = matchingChunkLength(passage.origin, anchor);
      if (size <= matched) continue;
      best = id;
      matched = size;
    }
    if (best) prioritized.set(best, [...(prioritized.get(best) ?? []), index]);
  }
  return prioritized;
}

function rankedPassages(
  passages: SourcePassage[],
  { query, anchors, explicit }: ReturnType<typeof studyQuery>,
  books: readonly StudyBook[],
  coverSources = false,
) {
  const ranges = new Map<string, StudyPassage>();
  const sources = new Map<string, Pick<Source, "id" | "title" | "kind">>();
  const size = coverSources ? 1_300 : undefined;
  const chunks = passages.flatMap((passage, index) => {
    const { sourceId, title } = passage;
    if (!sources.has(sourceId)) sources.set(sourceId, { id: sourceId, title, kind: "text" });
    if (passage.origin.kind === "source") {
      const id = `${index}:0`;
      const { origin, text } = passage;
      ranges.set(id, { origin, title, text });
      return [{ id, sourceId, title, text }];
    }
    const chunks: { id: string; sourceId: string; text: string; title: string }[] = [];
    for (const { start, offset, text } of studyTextWindows(passage.text, size)) {
      const id = `${index}:${start}`;
      const origin =
        passage.origin.kind === "book" && !passage.origin.highlightId
          ? { ...passage.origin, offset, length: text.length }
          : passage.origin;
      chunks.push({ id, sourceId, text, title });
      ranges.set(id, { title, origin, text });
    }
    return chunks;
  });
  const prioritized = previousCitationChunks(ranges, anchors, books);
  return selectPassages({
    sources: [...sources.values()],
    chunks,
    budget: 10_500,
    maxPassages: 8,
    query,
    coverSources: coverSources && (!explicit || !prioritized.size),
    priorityChunkIds: [...prioritized.keys()],
  }).flatMap(({ chunkId }) => {
    const passage = ranges.get(chunkId);
    if (!passage) return [];
    const previousCitations = prioritized.get(chunkId);
    return previousCitations ? { ...passage, previousCitations } : passage;
  });
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

function highlightPassages(
  highlight: StudyRecordOf<"highlight">,
  book: StudyBook,
): SourcePassage[] {
  const offset = locateStudyMark(book, highlight);
  const section = book.sections[highlight.section]?.title;
  const title = section && section !== book.title ? `${book.title} · ${section}` : book.title;
  const origin = {
    ...studyHighlightOrigin(highlight),
    ...(offset < 0
      ? {}
      : { offset, length: highlight.quote.length, revision: studyTextRevision(book) }),
  };
  const source = { sourceId: `highlight:${highlight.id}`, title, origin };
  const note = highlight.note.trim().slice(0, 1_050);
  return [
    { ...source, text: highlight.quote },
    ...(note ? [{ ...source, text: `Learner annotation:\n${note}` }] : []),
  ];
}

export function passagesFor(
  thread: StudyThread,
  {
    book,
    books = [],
    notes = [],
    notebookSources = [],
    cards = [],
    highlights = [],
    cardEvidence,
  }: StudyTutorSources,
  input: string,
  purpose: "chat" | "report" = "chat",
): StudyPassage[] {
  if (thread.scope === "cards") {
    const selection = selectedStudyCards(thread.cardIds, cards);
    const active = activeStudyCard(selection, thread.practiceCardId);
    const material =
      purpose === "report"
        ? selectedStudyCards(recentPracticeCards(thread.messages), selection).slice(0, 8)
        : active
          ? [active]
          : [];
    const evidence = new Map<string, StudyPassage>();
    for (const card of material)
      for (const passage of cardEvidence?.get(card.id) ?? []) {
        const { origin } = passage;
        const href = originHref(origin);
        const key = origin.kind === "note" && origin.passage ? `${href}#${origin.passage.offset}` : href;
        evidence.set(key, passage);
      }
    const sources = [...evidence.values()].slice(0, Math.min(3, 8 - material.length));
    const limit =
      purpose === "report"
        ? 1_300
        : 10_500 - sources.reduce((total, passage) => total + passage.text.length, 0);
    const exercises = material.map(({ id, front, back, quizChoices }): StudyPassage => {
      const question = front.trim().slice(0, Math.floor(limit / 3));
      const choicesHeading = "\n\nAnswer choices:\n";
      const choices = quizChoices?.length
        ? choicesHeading + quizChoicesText(quizChoices, Math.floor(limit / 3) - choicesHeading.length)
        : "";
      return {
        origin: { kind: "card", cardId: id },
        title: question.slice(0, 500),
        text: `Question: ${question}${choices}\n\nAnswer: ${back.trim().slice(0, limit - question.length - choices.length - 20)}`,
      };
    });
    return [...exercises, ...sources];
  }
  if (thread.scope === "notes" || thread.scope === "materials") {
    const originNotes = new Set(thread.noteIds);
    const passages = notes.filter(({ id }) => originNotes.has(id)).flatMap(notePassages);
    if (thread.scope === "materials") {
      const originBooks = new Set(thread.bookIds);
      const chosenBooks = books.filter(({ id }) => originBooks.has(id));
      passages.push(...chosenBooks.flatMap(bookPassages));
      const marked = new Set(thread.highlightIds);
      for (const { highlight, book: sourceBook } of highlights) {
        if (marked.has(highlight.id)) passages.push(...highlightPassages(highlight, sourceBook));
      }
      const bookSources = new Set(chosenBooks.map(({ sourceId }) => sourceId));
      const chosenSources = new Set(thread.sourceIds);
      for (const { id, notebookId, title, chunks } of notebookSources) {
        if (!chosenSources.has(id) || bookSources.has(id)) continue;
        for (const chunk of chunks) {
          if (!chunk.text.trim()) continue;
          passages.push({
            sourceId: `source:${id}`,
            origin: { kind: "source", sourceId: id, notebookId, chunkId: chunk.id },
            title,
            text: chunk.text,
          });
        }
      }
    }
    return rankedPassages(passages, studyQuery(input, thread, purpose), books, true);
  }
  if (thread.scope === "general" || !book) return [];
  const origin = tutorBookOrigin(thread, book);
  const { section: position } = origin;
  if (thread.scope === "image") {
    const section = book.sections[position];
    if (!origin.visual || !section) return [];
    return [{
      origin,
      title: `${book.title} · ${section.title}`,
      text: [thread.imageContext?.description, section.text.trim().slice(0, 8000)].filter(Boolean).join("\n\n"),
    }];
  }
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
    studyQuery(input, thread, purpose),
    [book],
  );
}
