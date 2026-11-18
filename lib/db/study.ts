import { generateId } from "ai";
import { freshSchedule, nextStudySchedule } from "@/lib/study/schedule";
import { originHref } from "@/lib/study/links";
import { studyPdfSections } from "@/lib/study/read-file";
import { studyTextEdit, studyTextRevision } from "@/lib/study/text-edits";
import type { StudyTutorSources } from "@/lib/study/passages";
import { recentPracticeCards, selectedStudyCards } from "@/lib/study/recall";
import { studyOriginRecordId, studyVaultIndex } from "@/lib/study/vault";
import { clearTutorDraftRecovery } from "@/lib/study/tutor-draft-recovery";
import { flashcardsData } from "@/studio/tools/flashcards/definition";
import { quizData } from "@/studio/tools/quiz/definition";
import { normaliseText } from "@/lib/grounding/chunk";
import type {
  StudyBook,
  StudyBookWrite,
  StudyOrigin,
  StudyThread,
  StudyThreadChange,
  StudyRecordOf,
  StudyRating,
  StudyRecord,
  StudySection,
  StudyReportChange,
  StudyReadingPlace,
  StudyTutorDraftChange,
} from "@/lib/study/records";
import { createNote } from "./notes";
import type { Note, Source, StudioOutput } from "./types";
import { useStoreQuery } from "./live";
import { createNotebook, deleteNotebook, renameNotebook } from "./notebooks";
import { addSource, chunksForSource, getChunks, renameSource } from "./sources";
import { store } from "./store";
import { currentVaultId, DEFAULT_VAULT, listVaults, vaultOf } from "./vaults";
import { getSettings } from "./settings";

export { freshSchedule } from "@/lib/study/schedule";

export function useStudyRecords() {
  return useStoreQuery(() => store().listStudy(), [], ["study"]);
}

function withCurrentStudyVault<T extends { notebookId?: string; vaultId?: string }>(row: T): T {
  return row.notebookId || row.vaultId ? row : { ...row, vaultId: currentVaultId() };
}

export function putStudyRecords(...rows: StudyRecord[]) {
  return store().putStudy(rows.map(withCurrentStudyVault));
}

export async function readStudyThread(id: string): Promise<StudyThread> {
  const thread = await store().getStudy(id);
  if (thread?.kind !== "thread") throw new Error("This Tutor conversation is no longer available.");
  return thread;
}

async function readStudyRowsInVault(ids: string[], vaultId: string, thread?: StudyThread) {
  const backend = store();
  const rows = new Map<string, StudyRecord>();
  const visited = new Set<string>();
  const noteIds = new Set<string>();
  async function read(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const row = id === thread?.id ? thread : await backend.getStudy(id);
    if (!row) return;
    rows.set(id, row);
    const origin = "origin" in row ? row.origin : undefined;
    if (origin?.kind === "note") noteIds.add(origin.noteId);
    const parents = ["bookId" in row ? row.bookId : undefined, studyOriginRecordId(origin)];
    await Promise.all(parents.map((parent) => parent && read(parent)));
  }
  const [notebooks, vaults] = await Promise.all([
    backend.listNotebooks(),
    listVaults(),
    Promise.all([...ids, ...(thread ? [thread.id] : [])].map(read)),
  ]);
  const notes = await Promise.all([...noteIds].map((id) => backend.getNote(id)));
  const scope = studyVaultIndex({
    rows: [...rows.values()],
    notebooks,
    notes: notes.filter((note) => note !== undefined),
    vaults,
    defaultVaultId: DEFAULT_VAULT,
  });
  if (thread && scope.owner(thread) !== vaultId) return [];
  return [...rows.values()].filter((row) => scope.owner(row) === vaultId);
}

async function readStudyCardsInVault(ids: string[], vaultId: string, thread?: StudyThread) {
  const rows = await readStudyRowsInVault(ids, vaultId, thread);
  return selectedStudyCards(ids, rows.filter((row) => row.kind === "card")).filter(
    ({ front, back }) => front.trim() && back.trim(),
  );
}

function highlightSources(rows: StudyRecord[], ids: string[]) {
  const records = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const highlight = records.get(id);
    if (highlight?.kind !== "highlight" || !highlight.quote.trim()) return [];
    const book = records.get(highlight.bookId);
    return book?.kind === "book" ? [{ highlight, book }] : [];
  });
}

export async function readStudyTutorSources(
  thread: StudyThread,
  vaultId: string,
  purpose: "chat" | "report" = "chat",
): Promise<StudyTutorSources> {
  if (thread.scope === "general") return {};
  if (thread.scope === "cards") {
    const ids = new Set(thread.cardIds);
    if (purpose === "report") {
      const practiced = recentPracticeCards(thread.messages).filter((id) => ids.has(id));
      return { cards: await readStudyCardsInVault(practiced, vaultId, thread) };
    }
    const first =
      thread.practiceCardId && ids.has(thread.practiceCardId)
        ? thread.practiceCardId
        : thread.cardIds?.[0];
    if (!first) return { cards: [] };
    const active = await readStudyCardsInVault([first], vaultId, thread);
    if (active.length) return { cards: active };
    ids.delete(first);
    return { cards: await readStudyCardsInVault([...ids], vaultId, thread) };
  }
  const backend = store();
  const bookIds = new Set(thread.scope === "materials" ? thread.bookIds : []);
  if (thread.bookId) bookIds.add(thread.bookId);
  const noteIds = new Set(
    thread.scope === "materials" || thread.scope === "notes" ? thread.noteIds : [],
  );
  const sourceIds = thread.scope === "materials" ? [...new Set(thread.sourceIds)] : [];
  const highlightIds = thread.scope === "materials" ? [...new Set(thread.highlightIds)] : [];
  const [records, savedNotes, savedSources, savedHighlights, notebooks, vaults] = await Promise.all([
    Promise.all([...bookIds].map((id) => backend.getStudy(id))),
    Promise.all([...noteIds].map((id) => backend.getNote(id))),
    sourceIds.length ? backend.getSources(sourceIds) : [],
    Promise.all(highlightIds.map((id) => backend.getStudy(id))),
    backend.listNotebooks(),
    listVaults(),
  ]);
  const highlights = savedHighlights.filter((row) => row?.kind === "highlight");
  const extraBookIds = [...new Set(highlights.map(({ bookId }) => bookId))].filter(
    (id) => !bookIds.has(id),
  );
  const relatedBooks = await Promise.all(extraBookIds.map((id) => backend.getStudy(id)));
  const books = [...records, ...relatedBooks].filter((row) => row?.kind === "book");
  const notes = savedNotes.filter((note) => note !== undefined);
  const scope = studyVaultIndex({
    rows: [thread, ...books, ...highlights],
    notebooks,
    notes,
    vaults,
    defaultVaultId: DEFAULT_VAULT,
  });
  if (scope.owner(thread) !== vaultId) return {};
  const visible = books.filter((book) => scope.owner(book) === vaultId);
  const notebookSources = savedSources.filter(
    ({ notebookId }) => scope.notebookOwner(notebookId) === vaultId,
  );
  const sourceChunks = notebookSources.length
    ? await getChunks(notebookSources.map(({ id }) => id))
    : [];
  const chunksBySource = new Map<string, typeof sourceChunks>();
  for (const chunk of sourceChunks) {
    const chunks = chunksBySource.get(chunk.sourceId);
    if (chunks) chunks.push(chunk);
    else chunksBySource.set(chunk.sourceId, [chunk]);
  }
  return {
    book: visible.find(({ id }) => id === thread.bookId),
    books: visible.filter(({ id }) => bookIds.has(id)),
    notes: notes.filter(({ id }) => scope.noteOwner(id) === vaultId),
    highlights: highlightSources(
      [...visible, ...highlights.filter((row) => scope.owner(row) === vaultId)],
      highlightIds,
    ),
    notebookSources: notebookSources.map(({ id, notebookId, title }) => ({
      id,
      notebookId,
      title,
      chunks: chunksBySource.get(id) ?? [],
    })),
  };
}

export async function updateStudyThread(
  id: string,
  change: StudyThreadChange,
  append: StudyThread["messages"] = [],
  draft?: StudyTutorDraftChange,
) {
  if (!(await store().patchStudyThread({ id, change, append, draft, updatedAt: Date.now() })))
    throw new Error("This Tutor conversation is no longer available.");
}

export function updateStudyReport(id: string, report: StudyReportChange) {
  return store().patchStudyThread({ id, report, change: {}, append: [], updatedAt: Date.now() });
}

export async function studyConversationDefaults(goal: StudyThread["goal"]) {
  const { study } = await getSettings();
  return {
    corrections: study?.corrections ?? (goal === "language" ? "live" : "off"),
    keepVoiceTranscripts: study?.keepVoiceTranscripts,
  } satisfies Pick<StudyThread, "corrections" | "keepVoiceTranscripts">;
}

export async function removeStudyRecord(id: string) {
  await store().deleteStudy(id);
  clearTutorDraftRecovery(id);
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
  vaultId?: string;
}): Promise<StudyBook> {
  const title = input.title.trim() || "Untitled";
  const notebookId = await createNotebook(title, { vaultId: input.vaultId ?? currentVaultId() });
  try {
    const text =
      input.format === "text" && input.sections.length === 1
        ? input.sections[0].text
        : input.sections.map(({ title, text }) => `${title}\n\n${text}`).join("\n\n");
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
  "front" | "back" | "image" | "backImage" | "tags" | "notebookId" | "origin" | "vaultId"
>;

export function newStudyCard(content: CardContent, id = studyId()): StudyCard {
  const now = Date.now();
  return withCurrentStudyVault({
    ...content,
    id,
    kind: "card",
    updatedAt: now,
    schedule: freshSchedule(now),
  });
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
  const word: StudyRecordOf<"word"> = withCurrentStudyVault({
    ...content,
    id,
    kind: "word",
    updatedAt: Date.now(),
  });
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

export async function startSourceTutor(sourceId: string) {
  const backend = store();
  const source = await backend.getSource(sourceId);
  const notebook = source && (await backend.getNotebook(source.notebookId));
  if (!source || !notebook) throw new Error("This source was removed.");
  const book = (await backend.listStudy()).find(
    (row) =>
      row.kind === "book" &&
      row.sourceId === source.id &&
      row.sections.some(({ text }) => text.trim()),
  );
  const thread: StudyThread = {
    id: studyId(),
    kind: "thread",
    title: source.title,
    goal: "book",
    scope: "materials",
    vaultId: vaultOf(notebook),
    ...(book ? { bookIds: [book.id] } : { sourceIds: [source.id] }),
    ...(await studyConversationDefaults("book")),
    messages: [],
    updatedAt: Date.now(),
  };
  await putStudyRecords(thread);
  return thread;
}

export async function startCardTutor(ids: string[], vaultId: string, title: string) {
  const cards = await readStudyCardsInVault(ids, vaultId);
  if (!cards.length) return null;
  const thread: StudyThread = {
    ...(await studyConversationDefaults("teach-back")),
    id: studyId(),
    kind: "thread",
    title,
    goal: "teach-back",
    scope: "cards",
    cardIds: cards.map(({ id }) => id),
    practiceCardId: cards[0].id,
    vaultId,
    messages: [],
    updatedAt: Date.now(),
  };
  await putStudyRecords(thread);
  return thread;
}

export async function startHighlightTutor(ids: string[], vaultId: string, title: string) {
  const highlights = highlightSources(await readStudyRowsInVault(ids, vaultId), [...new Set(ids)]);
  if (!highlights.length) return null;
  const thread: StudyThread = {
    ...(await studyConversationDefaults("book")),
    id: studyId(),
    kind: "thread",
    title,
    goal: "book",
    scope: "materials",
    highlightIds: highlights.map(({ highlight }) => highlight.id),
    vaultId,
    messages: [],
    updatedAt: Date.now(),
  };
  await putStudyRecords(thread);
  return thread;
}

export async function startBookTutor(
  book: StudyBook,
  focus: Pick<StudyThread, "scope" | "section" | "quote" | "offset" | "goal" | "revision">,
) {
  const thread: StudyThread = {
    ...focus,
    ...(await studyConversationDefaults(focus.goal)),
    id: studyId(),
    kind: "thread",
    title: focus.goal === "teach-back" ? `Teach it back · ${book.title}` : book.title,
    notebookId: book.notebookId,
    bookId: book.id,
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
  await store().patchStudyBook({ id: current.id, change: { title: next }, updatedAt: Date.now() });
}

export function updateStudyBook(id: string, change: Omit<StudyBookWrite["change"], "title">) {
  return store().patchStudyBook({ id, change, updatedAt: Date.now() });
}

export function saveStudyReadingPlace(id: string, readingPlace: StudyReadingPlace, capturedAt: number) {
  return store().patchStudyBook({ id, change: { readingPlace }, updatedAt: capturedAt });
}

export async function rateStudyItem(
  id: string,
  rating: StudyRating,
  seconds: number,
  review?: { sessionId: string; dueAt: number },
) {
  const backend = store();
  const record = await backend.getStudy(id);
  const now = Date.now();
  if (
    (record?.kind !== "card" && record?.kind !== "highlight") ||
    record.schedule.dueAt > now ||
    (review && record.schedule.dueAt !== review.dueAt)
  )
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
      reviewSessionId: review?.sessionId,
      origin:
        record.kind === "highlight"
          ? { kind: "book", bookId: record.bookId, section: record.section, highlightId: record.id }
          : record.origin,
      notebookId: record.notebookId,
      vaultId: record.vaultId,
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

export class StudyTextConflict extends Error {
  constructor() {
    super("This document was changed or removed while you were editing it.");
  }
}

export async function saveStudyText(
  bookId: string,
  text: string,
  draft?: { section: number; original: string },
) {
  const backend = store();
  const book = await backend.getStudy(bookId);
  if (book?.kind !== "book" || book.format !== "text" || book.attachedToNotebook)
    throw new Error("Choose a text document created in Study.");
  const section = draft?.section ?? 0;
  const previousText = book.sections[section]?.text;
  if (previousText === undefined || (draft && draft.original !== previousText))
    throw new StudyTextConflict();
  const body = text.replace(/\r\n?/g, "\n");
  const total = book.sections.reduce(
    (length, entry) => length + entry.text.length,
    body.length - previousText.length,
  );
  if (!body.trim() || total > 2_000_000)
    throw new Error("The document needs between 1 and 2,000,000 characters.");
  if (previousText === body) return;
  const source = await backend.getSource(book.sourceId);
  if (!source) throw new StudyTextConflict();
  const keepLegacyHeading =
    book.sections.length === 1 &&
    source.text === normaliseText(`${book.sections[0].title}\n\n${previousText}`);
  const sourceText = normaliseText(
    book.sections.length === 1 && !keepLegacyHeading
      ? body
      : book.sections
          .map((chapter, index) => `${chapter.title}\n\n${index === section ? body : chapter.text}`)
          .join("\n\n"),
  );
  if (!sourceText) throw new Error("The document needs readable text.");
  const revision = studyTextRevision(book);
  const saved = await backend.replaceStudyText(
    {
      id: book.id,
      sourceId: book.sourceId,
      revision,
      previousText,
      text: body,
      edit: studyTextEdit(section, previousText, body),
      updatedAt: Date.now(),
    },
    sourceText,
    chunksForSource({
      id: book.sourceId,
      notebookId: book.notebookId,
      text: sourceText,
      studyRevision: revision + 1,
    }),
  );
  if (!saved) throw new StudyTextConflict();
}
