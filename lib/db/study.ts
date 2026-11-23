import { generateId } from "ai";
import { flashcardPassageSize, maxDraftImages, maxStudyImageBytes, studyImageSchema, studyPracticeImages } from "@/lib/study/ai";
import { toBase64 } from "@/lib/base64";
import type { PassageRef } from "@/lib/chat/types";
import { notebookAnswerEvidence } from "@/lib/chat/study";
import { freshSchedule, nextStudySchedule } from "@/lib/study/schedule";
import { originHref, studyCitationOrigin } from "@/lib/study/links";
import { epubMime, readStudyEpub, studyPdfSections } from "@/lib/study/read-file";
import {
  findStudyDocumentExcerpt,
  studyDocumentContent,
  studyMarkdownContent,
} from "@/lib/study/markdown-document";
import { clearDocumentRecoveries } from "@/lib/study/document-drafts";
import { scanDraftId } from "@/lib/study/ocr-write";
import { clearFlashcardDraftsFrom } from "@/lib/study/flashcard-draft-recovery";
import { locateStudyMark, resolveStudyRange, studyTextEdit, studyTextRevision } from "@/lib/study/text-edits";
import { cardEvidenceLimit, studyCardPassage, type StudyDraftPassage, type StudyPassage, type StudyTutorSources } from "@/lib/study/passages";
import { locateCitedChunk } from "@/lib/study/locators";
import { vocabularyOrigin } from "@/lib/study/vocabulary";
import { isDifficultRating, recentPracticeCards, selectedStudyCards, studyHighlightPreview } from "@/lib/study/recall";
import { legacyQuizCardSource, quizCardContent } from "@/lib/study/quiz-cards";
import { studyFollowUpId, studyReportKey, studyReports } from "@/lib/study/reports";
import { studyTutorContextSchema } from "@/lib/study/records";
import { canEditStudyText, sourceStudyBookId } from "@/lib/study/library";
import { studyOriginRecordId, studyVaultIndex } from "@/lib/study/vault";
import { clearTutorDraftRecovery } from "@/lib/study/tutor-draft-recovery";
import { studyImageCropKey, studyImageFile, studyImageId, type StudyImageSnapshot } from "@/lib/study/visual-card";
import { flashcardsData } from "@/studio/tools/flashcards/definition";
import { quizData } from "@/studio/tools/quiz/definition";
import { normaliseText } from "@/lib/grounding/chunk";
import { locateNoteMatch, noteEditorText } from "@/lib/notes/search-match";
import { sectionOf } from "@/lib/notes/syntax";
import type {
  StudyFollowUp,
  StudyBook,
  StudyBookWrite,
  StudyOrigin,
  StudyOcrDraftWrite,
  StudyOcrPage,
  StudyOcrWrite,
  StudyThread,
  StudyThreadChange,
  StudyRecordOf,
  StudyRating,
  StudyRecord,
  StudyReviewAttempt,
  StudyReviewItemWrite,
  StudySection,
  StudyReportChange,
  StudyReadingPlace,
  StudyTutorDraft,
  StudyTutorDraftChange,
  StudyWord,
  StudyVisualOrigin,
} from "@/lib/study/records";
import { createNote } from "./notes";
import type { Note, StudioOutput } from "./types";
import { useStoreQuery } from "./live";
import { createNotebook, deleteNotebook } from "./notebooks";
import { addSource, chunksForSource, getChunks } from "./sources";
import { store } from "./store";
import { currentVaultId, DEFAULT_VAULT, listVaults, vaultOf } from "./vaults";
import { getSettings } from "./settings";

export { freshSchedule } from "@/lib/study/schedule";

async function withQuizChoices<Row extends StudyRecord>(rows: Row[]): Promise<Row[]> {
  const backend = store();
  async function readQuiz(outputId: string) {
    const output = await backend.getOutput(outputId);
    if (output?.toolId !== "quiz" || output.status !== "ready") return;
    const parsed = quizData.safeParse(output.data);
    if (parsed.success) return { notebookId: output.notebookId, questions: parsed.data.questions };
  }
  const outputs = new Map<string, ReturnType<typeof readQuiz>>();
  return Promise.all(rows.map(async (row) => {
    if (row.kind !== "card") return row;
    const source = legacyQuizCardSource(row);
    if (!source) return row;
    let pending = outputs.get(source.outputId);
    if (!pending) {
      pending = readQuiz(source.outputId);
      outputs.set(source.outputId, pending);
    }
    const output = await pending;
    if (output?.notebookId !== source.notebookId) return row;
    const original = quizCardContent(output.questions[source.position]);
    return original && original.front === row.front && original.back === row.back
      ? { ...row, quizChoices: original.quizChoices }
      : row;
  }));
}

export function useStudyRecords() {
  return useStoreQuery(async () => withQuizChoices(await store().listStudy()), [], ["study", "outputs"]);
}

/** Every Study document, without flashcards and the rest: for the notebooks page. */
export function useStudyBooks() {
  return useStoreQuery(
    async () => (await store().listStudy()).filter((row): row is StudyBook => row.kind === "book"),
    [],
    ["study"],
  );
}

/** A notebook's Study documents, flashcards and highlights. */
export function useNotebookStudy(notebookId: string) {
  return useStoreQuery(
    async () =>
      (await store().listStudy()).filter(
        (row): row is StudyRecordOf<"book" | "card" | "highlight"> =>
          row.notebookId === notebookId &&
          (row.kind === "book" || row.kind === "card" || row.kind === "highlight"),
      ),
    [notebookId],
    ["study"],
  );
}

export function useSavedStudyBookForSource(notebookId: string, sourceId: string, enabled: boolean) {
  return useStoreQuery(
    () => (enabled ? store().getStudyBookForSource(notebookId, sourceId) : Promise.resolve(undefined)),
    [notebookId, sourceId, enabled],
    ["study"],
  );
}

async function readDocumentSnapshot(book: StudyBook, section: number, anchor: StudyVisualOrigin) {
  if (!book.sections[section] || anchor.kind !== book.format) return;
  const file = await store().getBlob(studyImageId(book.id, section, anchor));
  if (
    !file || file.notebookId !== book.notebookId || file.sourceId !== book.sourceId ||
    file.data.byteLength > maxStudyImageBytes
  ) return;
  return studyImageSchema.safeParse(`data:${file.mime};base64,${toBase64(file.data)}`).data;
}

async function studyDocumentImage(book: StudyBook | undefined, thread: StudyThread) {
  const anchor = thread.imageContext?.anchor;
  const section = thread.section;
  if (thread.scope !== "image" || !book || !anchor || section === undefined || thread.bookId !== book.id) return;
  return readDocumentSnapshot(book, section, anchor);
}

export function useStudyDocumentImage(book: StudyBook | undefined, thread: StudyThread) {
  const anchor = thread.imageContext?.anchor;
  return useStoreQuery(
    async () => (await studyDocumentImage(book, thread)) ?? null,
    [book?.id, book?.notebookId, book?.sourceId, thread.bookId, thread.scope, thread.section,
      anchor?.kind, anchor?.kind === "pdf" ? anchor.top : anchor?.figure,
      anchor?.crop ? studyImageCropKey(anchor.crop) : undefined],
    ["blobs"],
  );
}

function withCurrentStudyVault<T extends { notebookId?: string; vaultId?: string }>(row: T): T {
  return row.notebookId || row.vaultId ? row : { ...row, vaultId: currentVaultId() };
}

export function putStudyRecords(...rows: StudyRecord[]) {
  return store().putStudy(rows.map(withCurrentStudyVault));
}

export async function readStudyThread(id: string): Promise<StudyThread> {
  const thread = await store().getStudy(id);
  if (thread?.kind !== "thread") throw new Error("This conversation is no longer available.");
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

export async function readStudyCardsInVault(ids: string[], vaultId: string, thread?: StudyThread) {
  const rows = await readStudyRowsInVault(ids, vaultId, thread);
  const cards = selectedStudyCards(ids, rows.filter((row) => row.kind === "card")).filter(
    ({ front, back }) => front.trim() && back.trim(),
  );
  return withQuizChoices(cards);
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

async function studyEvidenceReader(vaultId: string, limit = cardEvidenceLimit, includeImages = false) {
  const backend = store();
  const [notebooks, vaults] = await Promise.all([backend.listNotebooks(), listVaults()]);
  const ownership = { notebooks, vaults, rows: [], defaultVaultId: DEFAULT_VAULT };
  const { notebookOwner } = studyVaultIndex({ ...ownership, notes: [] });
  const sourceReads = new Map<string, ReturnType<typeof readNotebookSource>>();
  const savedSourceReads = new Map<string, Promise<StudyBook | undefined>>();
  const bookReads = new Map<string, ReturnType<typeof readStudyRowsInVault>>();
  const cardReads = new Map<string, ReturnType<typeof readStudyCardsInVault>>();

  async function readNotebookSource(id: string) {
    const source = await backend.getSource(id);
    if (!source || notebookOwner(source.notebookId) !== vaultId) return;
    return { source, chunks: await getChunks([source.id]) };
  }

  async function readPassage(origin: StudyOrigin): Promise<StudyDraftPassage | undefined> {
    if (origin.kind === "source") {
      if (notebookOwner(origin.notebookId) !== vaultId) return;
      const pending = sourceReads.get(origin.sourceId) ?? readNotebookSource(origin.sourceId);
      sourceReads.set(origin.sourceId, pending);
      const loaded = await pending;
      const snippet = origin.snippet?.slice(0, 280);
      const quoted = snippet?.replace(/…$/u, "").trim();
      if (!loaded) {
        if (!quoted) return;
        const key = JSON.stringify([origin.notebookId, origin.sourceId]);
        const saved =
          savedSourceReads.get(key) ??
          backend.getStudyBookForSource(origin.notebookId, origin.sourceId);
        savedSourceReads.set(key, saved);
        const book = await saved;
        if (book?.notebookId !== origin.notebookId) return;
        const range = findStudyDocumentExcerpt(book, quoted);
        if (!range) return;
        const { section, offset } = range;
        const length = Math.min(range.length, limit);
        return {
          origin: {
            kind: "book",
            bookId: book.id,
            section,
            offset,
            length,
            revision: studyTextRevision(book),
          },
          title: book.title.slice(0, 500),
          text: book.sections[section].text.slice(offset, offset + length),
        };
      }
      if (loaded.source.notebookId !== origin.notebookId) return;
      const { source, chunks } = loaded;
      const chunk = locateCitedChunk(chunks, origin.chunkId, quoted);
      if (!chunk) return;
      // A relocated excerpt confirms the saved quote, while its new surroundings may differ.
      const text = (chunk.id === origin.chunkId ? chunk.text : quoted)
        ?.trim()
        .slice(0, limit);
      if (text)
        return {
          origin: { ...origin, chunkId: chunk.id, snippet },
          title: source.title.slice(0, 500),
          text,
        };
    }
    if (origin.kind === "note") {
      const note = await backend.getNote(origin.noteId);
      if (!note || studyVaultIndex({ ...ownership, notes: [note] }).noteOwner(note.id) !== vaultId)
        return;
      if (origin.passage) {
        const offset = locateNoteMatch(noteEditorText(note.body), origin.passage);
        if (offset === undefined) return;
        const quote = origin.passage.quote.slice(0, limit);
        return {
          origin: { ...origin, passage: { offset, quote } },
          title: note.title.slice(0, 500),
          text: quote,
        };
      }
      const body = origin.heading ? sectionOf(note.body, origin.heading) : note.body;
      const text = body?.trim().slice(0, limit);
      if (text) return { origin, title: note.title.slice(0, 500), text };
    }
    if (origin.kind === "book") {
      const ids = [origin.bookId, ...(origin.highlightId ? [origin.highlightId] : [])];
      const key = JSON.stringify(ids);
      const pending = bookReads.get(key) ?? readStudyRowsInVault(ids, vaultId);
      bookReads.set(key, pending);
      const rows = await pending;
      const book = rows.find((row) => row.kind === "book" && row.id === origin.bookId);
      if (book?.kind !== "book") return;
      if (origin.visual && includeImages && origin.section !== undefined) {
        const image = await readDocumentSnapshot(book, origin.section, origin.visual);
        if (!image) return;
        return {
          origin,
          title: `${book.title} · ${book.sections[origin.section].title}`.slice(0, 500),
          text: "",
          image,
        };
      }
      const highlight = rows.find(
        (row) => row.kind === "highlight" && row.id === origin.highlightId,
      );
      const revision = studyTextRevision(book);
      if (origin.highlightId) {
        if (highlight?.kind !== "highlight" || highlight.bookId !== book.id) return;
        const offset = locateStudyMark(book, highlight);
        const text = highlight.quote.slice(0, limit);
        if (offset >= 0 && text.trim())
          return {
            origin: {
              ...origin,
              section: highlight.section,
              offset,
              length: text.length,
              revision,
            },
            title: book.title.slice(0, 500),
            text,
          };
        return;
      }
      const { section, offset, length } = origin;
      if (section === undefined || offset === undefined || !length) return;
      const range = resolveStudyRange(book, section, { offset, length, revision: origin.revision });
      if (!range) return;
      const end = range.offset + Math.min(range.length, limit);
      const text = book.sections[section].text.slice(range.offset, end);
      if (text.trim())
        return {
          origin: { ...origin, offset: range.offset, length: text.length, revision },
          title: book.title.slice(0, 500),
          text,
        };
    }
  }

  async function originsOf(card: StudyCard): Promise<StudyOrigin[]> {
    if (card.citations) return card.citations.slice(0, 8).map(studyCitationOrigin);
    const origin = card.origin;
    if (!origin) return [];
    if (origin.kind === "word") {
      const [word] = await readStudyRowsInVault([origin.wordId], vaultId);
      const original = word?.kind === "word" ? vocabularyOrigin(word) : undefined;
      return original ? [original] : [];
    }
    if (origin.kind === "tutor" && origin.message !== undefined) {
      const [thread] = await readStudyRowsInVault([origin.threadId], vaultId);
      const answer = thread?.kind === "thread" ? thread.messages[origin.message] : undefined;
      return answer?.role === "assistant" ? (answer.citations ?? []).slice(0, 8).map(studyCitationOrigin) : [];
    }
    if (origin.kind === "notebook-answer") {
      if (notebookOwner(origin.notebookId) !== vaultId) return [];
      const messages = await backend.loadMessages(origin.conversationId);
      const answer = messages.find(
        ({ message, notebookId }) =>
          notebookId === origin.notebookId &&
          message.id === origin.messageId &&
          message.role === "assistant",
      )?.message;
      return answer ? notebookAnswerEvidence(answer, origin.notebookId).slice(0, 8) : [];
    }
    return [origin];
  }

  const passages = new Map<string, ReturnType<typeof readPassage>>();
  function readOnce(origin: StudyOrigin) {
    const key = JSON.stringify(origin);
    const reading = passages.get(key) ?? readPassage(origin);
    passages.set(key, reading);
    return reading;
  }

  async function cardPassage(card: StudyCard, sources: StudyOrigin[]): Promise<StudyDraftPassage> {
    const passage = studyCardPassage(card, limit);
    const visual = sources.find((origin) => origin.kind === "book" && origin.visual);
    const original = visual && await readOnce(visual);
    if (original?.image) return passage;
    const { question, answer } = studyPracticeImages(card);
    return { ...passage, image: question ?? answer };
  }

  async function readEvidence(origins: readonly StudyOrigin[], count: number, includeCards = false) {
    const result: StudyDraftPassage[] = [];
    const seen = new Set<string>();
    const included = new Set<string>();
    let pending = origins;
    while (pending.length && result.length < count && seen.size < 32) {
      const group = new Map<string, StudyOrigin>();
      for (const origin of pending) {
        const key = JSON.stringify(origin);
        if (seen.has(key)) continue;
        seen.add(key);
        group.set(key, origin);
        if (group.size === 8 || seen.size === 32) break;
      }
      const resolved = await Promise.all([...group.values()].map(async (origin) => {
        if (origin.kind === "card") {
          const reading = cardReads.get(origin.cardId) ?? readStudyCardsInVault([origin.cardId], vaultId);
          cardReads.set(origin.cardId, reading);
          const [card] = await reading;
          if (!card) return {};
          const sources = await originsOf(card);
          return { passage: includeCards ? await cardPassage(card, sources) : undefined, sources };
        }
        return { passage: await readOnce(origin) };
      }));
      for (const { passage } of resolved) {
        if (!passage) continue;
        const { origin } = passage;
        const href = originHref(origin);
        const key = origin.kind === "note" && origin.passage
          ? JSON.stringify([href, origin.passage.offset, origin.passage.quote.length])
          : href;
        if (included.has(key)) continue;
        included.add(key);
        result.push(passage);
        if (result.length === count) break;
      }
      pending = resolved.flatMap(({ sources }) => sources ?? []);
    }
    return result;
  }
  return { originsOf, readEvidence };
}

export async function readFlashcardDraftPassages(origins: readonly StudyOrigin[], vaultId: string) {
  if (!origins.length) return [];
  const { readEvidence } = await studyEvidenceReader(vaultId, flashcardPassageSize, true);
  const passages = await readEvidence(origins, 8, true);
  let images = 0;
  return passages.filter((passage) => !passage.image || ++images <= maxDraftImages);
}

async function readFlashcardEvidence(cards: StudyCard[], vaultId: string) {
  const evidence = new Map<string, StudyPassage[]>();
  if (!cards.some((card) => card.origin || card.citations?.length)) return evidence;
  const { originsOf, readEvidence } = await studyEvidenceReader(vaultId);
  await Promise.all(
    cards.map(async (card) => {
      evidence.set(card.id, await readEvidence(await originsOf(card), 3));
    }),
  );
  return evidence;
}

export async function readStudyTutorSources(
  thread: StudyThread,
  vaultId: string,
  purpose: "chat" | "report" = "chat",
): Promise<StudyTutorSources> {
  if (thread.scope === "general") return {};
  if (thread.scope === "cards") {
    const ids = new Set(thread.cardIds);
    const withEvidence = async (cards: StudyCard[]) => ({
      cards,
      cardEvidence: await readFlashcardEvidence(cards, vaultId),
    });
    if (purpose === "report") {
      const practiced = recentPracticeCards(thread.messages).filter((id) => ids.has(id));
      return withEvidence(await readStudyCardsInVault(practiced, vaultId, thread));
    }
    const first =
      thread.practiceCardId && ids.has(thread.practiceCardId)
        ? thread.practiceCardId
        : thread.cardIds?.[0];
    if (!first) return { cards: [] };
    const active = await readStudyCardsInVault([first], vaultId, thread);
    if (active.length) return withEvidence(active);
    ids.delete(first);
    const remaining = await readStudyCardsInVault([...ids], vaultId, thread);
    return withEvidence(remaining.slice(0, 1));
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
  const book = visible.find(({ id }) => id === thread.bookId);
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
    book,
    ...(thread.scope === "image" && purpose === "chat"
      ? { documentImage: await studyDocumentImage(book, thread) }
      : {}),
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
    throw new Error("This conversation is no longer available.");
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
  clearFlashcardDraftsFrom(({ origin }) => {
    if (origin.kind === "book") return origin.bookId === id;
    return (origin.kind === "tutor" || origin.kind === "report") && origin.threadId === id;
  });
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
  /** Where it came from, e.g. the video a transcript is of. Kept on the notebook source. */
  url?: string;
  /**
   * The notebook to add it to, as one more source. Without one, a notebook of
   * its own is made, named after the document.
   */
  notebookId?: string;
}): Promise<StudyBook> {
  const title = input.title.trim() || "Untitled";
  const existing = input.notebookId;
  if (existing && !(await store().getNotebook(existing))) throw new Error("This notebook was removed.");
  const notebookId = existing ?? (await createNotebook(title, { vaultId: input.vaultId ?? currentVaultId() }));
  try {
    const text =
      input.format === "text" && input.sections.length === 1
        ? input.sections[0].text
        : input.sections
            .filter(({ text }) => normaliseText(text))
            .map(({ title, text }) => `${title}\n\n${text}`)
            .join("\n\n");
    const source = await addSource({
      notebookId,
      title,
      text,
      kind: input.format,
      url: input.url,
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
      ...(existing ? { attachedToNotebook: true as const } : {}),
      updatedAt: Date.now(),
    };
    await putStudyRecords(book);
    return book;
  } catch (error) {
    if (!existing) await deleteNotebook(notebookId);
    throw error;
  }
}

export async function studyBookForSource(sourceId: string) {
  const backend = store();
  const source = await backend.getSource(sourceId);
  if (!source) throw new Error("This source was removed.");
  const existing = await backend.getStudyBookForSource(source.notebookId, sourceId);
  if (existing) return existing;
  const original = source.originalFileId ? await backend.getBlob(source.originalFileId) : undefined;
  const book: StudyBook = {
    id: sourceStudyBookId(source.id),
    kind: "book",
    notebookId: source.notebookId,
    sourceId: source.id,
    title: source.title,
    format: "text",
    sections: [{ title: source.title, text: source.text }],
    section: 0,
    bookmarks: [],
    attachedToNotebook: true,
    updatedAt: Date.now(),
  };
  if (original?.mime === "application/pdf") {
    const pages = await studyPdfSections(original.data).catch(() => undefined);
    if (pages?.length) {
      book.format = "pdf";
      book.fileId = original.id;
      book.sections = pages.map((page, index) => {
        const recognized = source.pdfOcr?.pages[index];
        return recognized && !page.text.trim()
          ? { ...page, text: recognized.text, ocrLanguages: recognized.languages }
          : page;
      });
      book.textEdits = source.pdfOcr?.edits;
    }
  } else if (original?.mime === epubMime) {
    const epub = await readStudyEpub(original.data).catch(() => undefined);
    if (epub?.sections.length) {
      book.format = "epub";
      book.fileId = original.id;
      book.sections = epub.sections;
    }
  } else if (source.kind === "markdown") {
    const body = original ? new TextDecoder().decode(original.data) : source.text;
    const content = studyMarkdownContent(body);
    if (content.text) {
      book.fileId = original?.id;
      book.sections = [{ title: source.title, ...content }];
    }
  }
  if (!source.text.trim() && !book.fileId) throw new Error("The original document could not be opened.");
  const linked = await backend.attachStudyBook(book);
  if (linked) return linked;
  throw new Error("This source was removed.");
}

export async function deleteStudyBook(book: StudyBook) {
  if (book.attachedToNotebook) await removeStudyRecord(book.id);
  else await deleteNotebook(book.notebookId);
  clearDocumentRecoveries(`document-draft:book:${book.id}:`);
}

export type StudyCard = StudyRecordOf<"card">;
type CardContent = Pick<
  StudyCard,
  "front" | "back" | "quizChoices" | "image" | "backImage" | "tags" | "notebookId" | "origin" | "vaultId" | "citations"
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

export async function saveStudyVisualCard(book: StudyBook, section: number, visual: StudyVisualOrigin, content: CardContent) {
  const { question, answer } = studyPracticeImages(content);
  const image = question ?? answer;
  if (!image) throw new Error("The document image could not be saved.");
  await saveStudyImageSnapshot(book, section, visual, studyImageFile(image));
  return saveStudyCard({ ...content, origin: { kind: "book", bookId: book.id, section, visual } });
}

export function saveStudyDraftCards(cards: StudyCard[]) {
  return store().insertStudy(cards);
}

export function updateStudyReviewItem(write: StudyReviewItemWrite) {
  return store().patchStudyReviewItem(write);
}

export async function saveStudyWord(
  content: Omit<StudyWord, "id" | "updatedAt" | "kind">,
  id = studyId(),
) {
  const notebook = content.notebookId && await store().getNotebook(content.notebookId);
  const vaultId = content.vaultId ?? (notebook ? vaultOf(notebook) : currentVaultId());
  const result = await store().writeStudyVocabulary({
    kind: "capture",
    vaultId,
    word: { ...content, id, kind: "word", vaultId, updatedAt: Date.now() },
  });
  if (result.kind !== "word") throw new Error("This vocabulary entry is no longer available.");
  return result.word;
}

export async function updateStudyWord(word: StudyWord, vaultId: string) {
  const result = await store().writeStudyVocabulary({ kind: "edit", word: { ...word, updatedAt: Date.now() }, vaultId });
  if (result.kind === "duplicate") throw new Error("That word is already saved for this language.");
  if (result.kind !== "word") throw new Error("This vocabulary entry is no longer available.");
  return result.word;
}

export async function studyVocabularyCards(ids: string[], vaultId: string) {
  const result = await store().writeStudyVocabulary({ kind: "cards", ids, vaultId, updatedAt: Date.now() });
  return result.kind === "cards" ? result.cardIds : [];
}

function studioCardCitations(
  notebookId: string,
  sources?: readonly PassageRef[],
): StudyCard["citations"] {
  return sources
    ?.filter(({ n }) => Number.isSafeInteger(n) && n > 0)
    .slice(0, 3)
    .map(({ n, title, sourceId, chunkId, snippet }) => ({
      index: n,
      title,
      origin: { kind: "source", notebookId, sourceId, chunkId, snippet: snippet.slice(0, 280) },
    }));
}

async function saveStudioReviewCards(cards: StudyCard[]) {
  const added = await store().insertStudy(cards);
  return { added, cardIds: cards.map(({ id }) => id) };
}

export async function addStudioFlashcards(output: StudioOutput, positions?: readonly number[]) {
  if (output.status !== "ready" || output.toolId !== "flashcards")
    throw new Error("Open a completed Studio flashcard set first.");
  const parsed = flashcardsData.parse(output.data);
  const selected = positions ? [...new Set(positions)] : parsed.cards.map((_, position) => position);
  return saveStudioReviewCards(
    selected.flatMap((position) => {
      const card = parsed.cards[position];
      if (!card) return [];
      return [
        newStudyCard(
          {
            front: card.front,
            back: card.back,
            tags: [output.title],
            notebookId: output.notebookId,
            origin: { kind: "studio", notebookId: output.notebookId, outputId: output.id },
            citations: studioCardCitations(output.notebookId, card.sources),
          },
          `studio-${output.id}-${position}`,
        ),
      ];
    }),
  );
}

export async function addQuizMissesToStudy(output: StudioOutput, missed: readonly number[]) {
  if (output.status !== "ready" || output.toolId !== "quiz")
    throw new Error("Open a completed Studio quiz first.");
  const { questions } = quizData.parse(output.data);
  const cards = [...new Set(missed)].flatMap((position) => {
    const question = questions[position];
    const content = quizCardContent(question);
    if (!content) return [];
    return [
      newStudyCard(
        {
          notebookId: output.notebookId,
          origin: { kind: "studio", notebookId: output.notebookId, outputId: output.id },
          citations: studioCardCitations(output.notebookId, question.sources),
          ...content,
          tags: [output.title],
        },
        `quiz-${output.id}-${position}`,
      ),
    ];
  });
  if (!cards.length) throw new Error("This quiz has no missed questions to add.");
  return saveStudioReviewCards(cards);
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
  const saved = await backend.getStudyBookForSource(notebook.id, source.id);
  const book = saved?.sections.some(({ text }) => text.trim()) ? saved : undefined;
  if (!book && !source.text.trim()) throw new Error("This source has no selectable text.");
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

async function openScopedTutor(thread: StudyThread) {
  const backend = store();
  if (await backend.insertStudy([thread])) return thread;
  const saved = await backend.getStudy(thread.id);
  if (saved?.kind === "thread" && saved.vaultId === thread.vaultId) return saved;
  throw new Error("This conversation is no longer available.");
}

export async function startCardTutor(ids: string[], vaultId: string, title: string, draft?: StudyTutorDraft, id = studyId()) {
  const cards = await readStudyCardsInVault(ids, vaultId);
  if (!cards.length) return null;
  const thread: StudyThread = {
    ...(await studyConversationDefaults("teach-back")),
    id,
    kind: "thread",
    title,
    goal: "teach-back",
    scope: "cards",
    cardIds: cards.map(({ id }) => id),
    practiceCardId: cards[0].id,
    vaultId,
    draft,
    messages: [],
    updatedAt: Date.now(),
  };
  return openScopedTutor(thread);
}

export async function startHighlightTutor(ids: string[], vaultId: string, title: string, draft?: StudyTutorDraft, id = studyId()) {
  const highlights = highlightSources(await readStudyRowsInVault(ids, vaultId), [...new Set(ids)]);
  if (!highlights.length) return null;
  const thread: StudyThread = {
    ...(await studyConversationDefaults("book")),
    id,
    kind: "thread",
    title,
    goal: "book",
    scope: "materials",
    highlightIds: highlights.map(({ highlight }) => highlight.id),
    vaultId,
    draft,
    messages: [],
    updatedAt: Date.now(),
  };
  return openScopedTutor(thread);
}

export async function startStudyFollowUp(
  target: Omit<StudyFollowUp, "text">,
  vaultId: string,
) {
  const id = studyFollowUpId(target);
  const rows = await readStudyRowsInVault([target.threadId, id], vaultId);
  const parent = rows.find((row) => row.id === target.threadId);
  if (parent?.kind !== "thread") return;
  const report = studyReports(parent).find((report) => studyReportKey(report) === target.reportId);
  const step = report?.plannedSteps?.[target.index];
  const text = report?.nextSteps[target.index]?.trim();
  if (!step || step.completedAt !== undefined || !text) return;

  const existing = rows.find((row) => row.id === id);
  if (existing?.kind === "thread" && existing.followUp && studyFollowUpId(existing.followUp) === id)
    return id;

  const context = report.practiceContext ?? studyTutorContextSchema.parse(parent);
  const backend = store();
  const inserted = await backend.insertStudy([{
    ...(await studyConversationDefaults(context.goal)),
    ...context,
    id,
    kind: "thread",
    title: studyHighlightPreview(text),
    notebookId: parent.notebookId,
    vaultId,
    followUp: { ...target, text },
    messages: [],
    updatedAt: Date.now(),
  }]);
  if (inserted) return id;
  const saved = (await readStudyRowsInVault([id], vaultId))[0];
  if (saved?.kind === "thread" && saved.followUp && studyFollowUpId(saved.followUp) === id) return id;
}

export async function startBookTutor(
  book: StudyBook,
  focus: Pick<StudyThread, "scope" | "section" | "quote" | "offset" | "goal" | "revision">,
  messages: StudyThread["messages"] = [],
) {
  const thread: StudyThread = {
    ...focus,
    ...(await studyConversationDefaults(focus.goal)),
    id: studyId(),
    kind: "thread",
    title: focus.goal === "teach-back" ? `Teach it back · ${book.title}` : book.title,
    notebookId: book.notebookId,
    bookId: book.id,
    messages,
    updatedAt: Date.now(),
  };
  await putStudyRecords(thread);
  return thread;
}

async function saveStudyImageSnapshot(
  book: StudyBook, section: number, anchor: StudyVisualOrigin, file: StudyImageSnapshot["file"],
) {
  const backend = store();
  if (!file.data.byteLength || file.data.byteLength > maxStudyImageBytes ||
    !studyImageSchema.safeParse(`data:${file.mime};base64,${toBase64(file.data)}`).success) {
    throw new Error("The document image could not be saved.");
  }
  const source = await backend.getSource(book.sourceId);
  if (!source || source.notebookId !== book.notebookId || source.originalFileId !== book.fileId ||
    !book.fileId || !book.sections[section] || anchor.kind !== book.format)
    throw new Error("The original document is unavailable.");
  const fileId = studyImageId(book.id, section, anchor);
  await backend.putBlob({
    id: fileId,
    notebookId: book.notebookId,
    sourceId: book.sourceId,
    createdAt: Date.now(),
    ...file,
  });
  return fileId;
}

export async function startBookImageTutor(book: StudyBook, section: number, snapshot: StudyImageSnapshot) {
  const { context, file } = snapshot;
  const fileId = await saveStudyImageSnapshot(book, section, context.anchor, file);
  const backend = store();
  const thread: StudyThread = {
    ...(await studyConversationDefaults("book")),
    id: `${fileId}:tutor`,
    kind: "thread",
    title: `${book.title} · ${context.description || book.sections[section].title}`,
    goal: "book",
    scope: "image",
    notebookId: book.notebookId,
    bookId: book.id,
    section,
    imageContext: context,
    messages: [],
    updatedAt: Date.now(),
  };
  if (await backend.insertStudy([thread])) return thread;
  const saved = await readStudyThread(thread.id);
  if (saved.scope === "image") return saved;
  await updateStudyThread(saved.id, { scope: "image" });
  return { ...saved, scope: "image" as const };
}

export async function saveStudyNote({
  title,
  body,
  origin,
  imageReferences = [],
  notebookId,
  vaultId,
}: {
  title: string;
  body: string;
  origin: StudyOrigin;
  imageReferences?: readonly StudyOrigin[];
  notebookId?: string;
  vaultId?: string;
}) {
  const notebook = notebookId ? await store().getNotebook(notebookId) : undefined;
  const original = originHref(origin);
  const imageLinks = [...new Set(imageReferences.flatMap((reference) =>
    reference.kind === "book" && reference.visual ? [originHref(reference)] : [],
  ))].filter((href) => href !== original);
  return createNote({
    title,
    body: [body.trim(), `[Open original](${original})`, ...imageLinks.map((href, index) =>
      `[Open image source${imageLinks.length > 1 ? ` ${index + 1}` : ""}](${href})`,
    )].join("\n\n"),
    notebookId: notebook?.id,
    vaultId: notebook ? vaultOf(notebook) : (vaultId ?? currentVaultId()),
  });
}

export async function renameStudyBook(book: StudyBook, title: string) {
  const next = title.trim();
  if (next)
    await store().renameDocument({ kind: "book", id: book.id, title: next, updatedAt: Date.now() });
}

export function updateStudyBook(id: string, change: StudyBookWrite["change"]) {
  return store().patchStudyBook({ id, change, updatedAt: Date.now() });
}

export function saveStudyReadingPlace(id: string, readingPlace: StudyReadingPlace, capturedAt: number) {
  return store().patchStudyBook({ id, change: { readingPlace }, updatedAt: capturedAt });
}

export async function rateStudyItem(
  id: string,
  rating: StudyRating,
  seconds: number,
  review?: { sessionId: string; dueAt: number; attempt?: StudyReviewAttempt },
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
      reviewAttempt: isDifficultRating(rating) ? review?.attempt : undefined,
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

export async function recordStudyActivity({
  activity,
  seconds,
  notebookId,
  origin,
  activitySessionId,
}: Pick<StudyRecordOf<"session">, "seconds" | "notebookId" | "origin" | "activitySessionId"> & {
  activity: "reading" | "speaking";
}) {
  if (seconds < 1) return;
  await putStudyRecords({
    id: studyId(),
    kind: "session",
    activity,
    seconds,
    count: 1,
    activitySessionId,
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

export async function saveStudyOcrPages(write: Omit<StudyOcrWrite, "updatedAt">) {
  const saved = await store().saveStudyOcrPages({ ...write, updatedAt: Date.now() });
  if (saved === "conflict") throw new StudyTextConflict();
  if (saved === "limit") throw new Error("The reviewed text exceeds the page or document size limit.");
}

export function writeStudyOcrDraft(write: Omit<StudyOcrDraftWrite, "updatedAt">) {
  return store().writeStudyOcrDraft({ ...write, updatedAt: Date.now() });
}

export async function readStudyOcrDraft(bookId: string, fileId: string) {
  const row = await store().getStudy(scanDraftId(bookId));
  if (row?.kind === "ocr-draft" && row.fileId === fileId) return row;
}

export function saveStudyOcrText({ bookId, fileId, ...page }: Pick<StudyOcrWrite, "bookId" | "fileId"> & StudyOcrPage) {
  return saveStudyOcrPages({ bookId, fileId, pages: [page] });
}

export async function saveStudyText(
  bookId: string,
  text: string,
  draft?: { section: number; original: string; originalMarkdown?: string; markdown?: boolean },
) {
  const backend = store();
  const book = await backend.getStudy(bookId);
  if (book?.kind !== "book" || !canEditStudyText(book))
    throw new Error("Choose a text document created in Study.");
  const section = draft?.section ?? 0;
  const previous = book.sections[section];
  if (!previous || (draft && (draft.original !== previous.text || draft.originalMarkdown !== previous.markdown)))
    throw new StudyTextConflict();
  if (!text.trim() || text.length > 2_000_000)
    throw new Error("The document needs between 1 and 2,000,000 characters.");
  const previousText = previous.text;
  const markdown = draft?.markdown ?? (previous.markdown !== undefined);
  const content = studyDocumentContent(text, markdown);
  const body = content.text;
  const total = book.sections.reduce(
    (length, entry) => length + entry.text.length,
    body.length - previousText.length,
  );
  if (!body.trim() || total > 2_000_000)
    throw new Error("The document needs between 1 and 2,000,000 characters.");
  if (previousText === body && previous.markdown === content.markdown) return;
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
      previousMarkdown: previous.markdown,
      ...content,
      edit: studyTextEdit(section, previousText, body),
      updatedAt: Date.now(),
    },
    sourceText,
    previousText === body ? [] : chunksForSource({
      id: book.sourceId,
      notebookId: book.notebookId,
      text: sourceText,
      studyRevision: revision + 1,
    }),
  );
  if (!saved) throw new StudyTextConflict();
}
