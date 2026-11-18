import { generateId } from "ai";
import { freshSchedule, nextStudySchedule } from "@/lib/study/schedule";
import { originHref } from "@/lib/study/links";
import { studyPdfSections } from "@/lib/study/read-file";
import { flashcardsData } from "@/studio/tools/flashcards/definition";
import { quizData } from "@/studio/tools/quiz/definition";
import { chunkText, normaliseText } from "@/lib/grounding/chunk";
import type {
  StudyBook,
  StudyOrigin,
  StudyThread,
  StudyThreadChange,
  StudyRecordOf,
  StudyRating,
  StudyRecord,
  StudySection,
} from "@/lib/study/records";
import { createNote } from "./notes";
import type { Note, Source, StudioOutput } from "./types";
import { useStoreQuery } from "./live";
import { createNotebook, deleteNotebook, renameNotebook } from "./notebooks";
import { addSource, renameSource } from "./sources";
import { store } from "./store";
import { currentVaultId, vaultOf } from "./vaults";
import { getSettings } from "./settings";

export { freshSchedule } from "@/lib/study/schedule";

export function useStudyRecords() {
  return useStoreQuery(() => store().listStudy(), [], ["study"]);
}

export function putStudyRecords(...rows: StudyRecord[]) {
  return store().putStudy(rows);
}

export async function updateStudyThread(
  id: string,
  change: StudyThreadChange,
  append: StudyThread["messages"] = [],
) {
  if (!(await store().patchStudyThread({ id, change, append, updatedAt: Date.now() })))
    throw new Error("This Tutor conversation is no longer available.");
}

export async function studyConversationDefaults(goal: StudyThread["goal"]) {
  const { study } = await getSettings();
  return {
    corrections: study?.corrections ?? (goal === "language" ? "live" : "off"),
    keepVoiceTranscripts: study?.keepVoiceTranscripts,
  } satisfies Pick<StudyThread, "corrections" | "keepVoiceTranscripts">;
}

export function removeStudyRecord(id: string) {
  return store().deleteStudy(id);
}

export function studyId() {
  return generateId();
}

export async function addStudyBook(input: {
  title: string;
  format: StudyBook["format"];
  sections: StudySection[];
  bytes?: Uint8Array;
  mime?: string;
}): Promise<StudyBook> {
  const title = input.title.trim() || "Untitled";
  const notebookId = await createNotebook(title, { vaultId: currentVaultId() });
  try {
    const text = input.sections
      .map((section) => `${section.title}\n\n${section.text}`)
      .join("\n\n");
    const source = await addSource({
      notebookId,
      title,
      text,
      kind: input.format === "pdf" ? "pdf" : "text",
      original: input.bytes && input.mime ? { data: input.bytes, mime: input.mime } : undefined,
    });
    const book: StudyBook = {
      id: studyId(),
      kind: "book",
      notebookId,
      sourceId: source.id,
      fileId: source.originalFileId,
      title,
      format: input.format,
      sections: input.sections,
      section: 0,
      bookmarks: [],
      updatedAt: Date.now(),
    };
    await putStudyRecords(book);
    return book;
  } catch (error) {
    await deleteNotebook(notebookId);
    throw error;
  }
}

export async function studyBookForSource(sourceId: string) {
  const backend = store();
  const existing = (await backend.listStudy()).find(
    (row): row is StudyBook => row.kind === "book" && row.sourceId === sourceId,
  );
  if (existing) return existing;
  const source = await backend.getSource(sourceId);
  if (!source) throw new Error("This source was removed.");
  const original =
    source.kind === "pdf" && source.originalFileId
      ? await backend.getBlob(source.originalFileId)
      : undefined;
  const pages =
    original?.mime === "application/pdf"
      ? await studyPdfSections(original.data).catch(() => undefined)
      : undefined;
  const book = bookFromSource(
    source,
    pages && original ? { sections: pages, fileId: original.id } : undefined,
  );
  await backend.insertStudy([book]);
  return book;
}

function bookFromSource(source: Source, pdf?: Pick<StudyBook, "sections" | "fileId">): StudyBook {
  return {
    id: `source-${source.id}`,
    kind: "book",
    notebookId: source.notebookId,
    sourceId: source.id,
    title: source.title,
    format: pdf ? "pdf" : "text",
    fileId: pdf?.fileId,
    sections: pdf?.sections ?? [{ title: source.title, text: source.text }],
    section: 0,
    bookmarks: [],
    attachedToNotebook: true,
    updatedAt: Date.now(),
  };
}

export async function deleteStudyBook(book: StudyBook) {
  if (book.attachedToNotebook) await removeStudyRecord(book.id);
  else await deleteNotebook(book.notebookId);
}

export type StudyCard = StudyRecordOf<"card">;
type CardContent = Pick<
  StudyCard,
  "front" | "back" | "image" | "backImage" | "tags" | "notebookId" | "origin"
>;

export function newStudyCard(content: CardContent, id = studyId()): StudyCard {
  const now = Date.now();
  return { ...content, id, kind: "card", updatedAt: now, schedule: freshSchedule(now) };
}

export async function saveStudyCard(content: CardContent, id?: string) {
  const card = newStudyCard(content, id);
  await store().insertStudy([card]);
  return card;
}

export async function saveStudyWord(
  content: Omit<StudyRecordOf<"word">, "id" | "updatedAt" | "kind">,
  id = studyId(),
) {
  const word: StudyRecordOf<"word"> = { ...content, id, kind: "word", updatedAt: Date.now() };
  await store().insertStudy([word]);
  return word;
}

export async function addStudioFlashcards(output: StudioOutput) {
  if (output.status !== "ready" || output.toolId !== "flashcards")
    throw new Error("Open a completed Studio flashcard set first.");
  const parsed = flashcardsData.parse(output.data);
  return store().insertStudy(
    parsed.cards.map(({ front, back }, position) =>
      newStudyCard(
        {
          front,
          back,
          tags: [output.title],
          notebookId: output.notebookId,
          origin: { kind: "studio", notebookId: output.notebookId, outputId: output.id },
        },
        `studio-${output.id}-${position}`,
      ),
    ),
  );
}

export async function addQuizMissesToStudy(output: StudioOutput, missed: readonly number[]) {
  if (output.status !== "ready" || output.toolId !== "quiz")
    throw new Error("Open a completed Studio quiz first.");
  const { questions } = quizData.parse(output.data);
  const cards = [...new Set(missed)].flatMap((position) => {
    const question = questions[position];
    const answer = question?.options[question.answer]?.trim();
    if (!question?.question.trim() || !answer) return [];
    return [
      newStudyCard(
        {
          notebookId: output.notebookId,
          origin: { kind: "studio", notebookId: output.notebookId, outputId: output.id },
          front: question.question.trim(),
          back: [answer, question.explanation.trim()].filter(Boolean).join("\n\n"),
          tags: [output.title],
        },
        `quiz-${output.id}-${position}`,
      ),
    ];
  });
  if (!cards.length) throw new Error("This quiz has no missed questions to add.");
  return store().insertStudy(cards);
}

export async function startNoteTutor(note: Pick<Note, "id" | "vaultId" | "notebookId" | "title">) {
  const thread: StudyThread = {
    id: studyId(),
    kind: "thread",
    title: note.title,
    goal: "book",
    scope: "notes",
    notebookId: note.notebookId ?? undefined,
    noteIds: [note.id],
    vaultId: note.vaultId,
    ...(await studyConversationDefaults("book")),
    messages: [],
    updatedAt: Date.now(),
  };
  await putStudyRecords(thread);
  return thread;
}

export async function saveStudyNote({
  title,
  body,
  origin,
  notebookId,
  vaultId,
}: {
  title: string;
  body: string;
  origin: StudyOrigin;
  notebookId?: string;
  vaultId?: string;
}) {
  const notebook = notebookId ? await store().getNotebook(notebookId) : undefined;
  return createNote({
    title,
    body: `${body.trim()}

[Open original](${originHref(origin)})`,
    notebookId: notebook?.id,
    vaultId: notebook ? vaultOf(notebook) : (vaultId ?? currentVaultId()),
  });
}

export async function renameStudyBook(book: StudyBook, title: string) {
  const current = await store().getStudy(book.id);
  const next = title.trim();
  if (!next || current?.kind !== "book") return;
  if (!current.attachedToNotebook) {
    await renameNotebook(current.notebookId, next);
    await renameSource(current.sourceId, next);
  }
  await putStudyRecords({ ...current, title: next, updatedAt: Date.now() });
}

export async function updateStudyBook(
  bookId: string,
  patch: Pick<Partial<StudyBook>, "section" | "bookmarks" | "bookmarkPlaces">,
) {
  const book = await store().getStudy(bookId);
  if (book?.kind !== "book") return;
  const now = Date.now();
  await putStudyRecords({
    ...book,
    ...patch,
    updatedAt: now,
    lastReadAt: patch.section === undefined ? book.lastReadAt : now,
  });
}

export async function rateStudyItem(id: string, rating: StudyRating, seconds: number) {
  const backend = store();
  const record = await backend.getStudy(id);
  const now = Date.now();
  if ((record?.kind !== "card" && record?.kind !== "highlight") || record.schedule.dueAt > now)
    return false;
  return backend.applyStudyReview({
    id,
    previousDueAt: record.schedule.dueAt,
    schedule: nextStudySchedule(record.schedule, rating, now),
    activity: {
      id: studyId(),
      kind: "session",
      activity: "review",
      rating,
      itemId: id,
      origin:
        record.kind === "highlight"
          ? { kind: "book", bookId: record.bookId, section: record.section, highlightId: record.id }
          : record.origin,
      notebookId: record.notebookId,
      seconds: Math.max(0, Math.min(seconds, 120)),
      count: 1,
      updatedAt: now,
    },
  });
}

export async function recordStudyActivity(
  activity: "reading" | "speaking",
  seconds: number,
  notebookId?: string,
  origin?: StudyOrigin,
) {
  if (seconds < 1) return;
  await putStudyRecords({
    id: studyId(),
    kind: "session",
    activity,
    seconds,
    count: 1,
    notebookId,
    origin,
    updatedAt: Date.now(),
  });
}

export async function saveStudyText(bookId: string, text: string) {
  const backend = store();
  const book = await backend.getStudy(bookId);
  if (book?.kind !== "book" || book.format !== "text" || book.attachedToNotebook)
    throw new Error("Choose a text document created in Study.");
  const source = await backend.getSource(book.sourceId);
  if (!source) throw new Error("The notebook source was deleted.");
  const body = normaliseText(text);
  if (!body || body.length > 2_000_000)
    throw new Error("The document needs between 1 and 2,000,000 characters.");
  const revised = { ...source, text: body, charCount: body.length };
  const chapters = [{ ...book.sections[0], text: body }];
  await backend.replaceStudyText(
    { ...book, sections: chapters, updatedAt: Date.now() },
    revised,
    chunkText(body).map((part, index) => ({
      id: `${source.id}:${index}`,
      notebookId: source.notebookId,
      sourceId: source.id,
      index,
      text: part,
    })),
  );
}
