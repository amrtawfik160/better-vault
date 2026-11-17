import { generateId } from "ai";
import { chunkText, normaliseText } from "@/lib/grounding/chunk";
import type {
  StudyBook,
  StudyRating,
  StudyRecord,
  StudySchedule,
  StudySection,
} from "@/lib/study/records";
import { saveBlob } from "./blobs";
import { useStoreQuery } from "./live";
import { createNotebook, deleteNotebook, renameNotebook } from "./notebooks";
import { addSource, renameSource } from "./sources";
import { store } from "./store";
import { currentVaultId } from "./vaults";

const day = 86_400_000;

export function useStudyRecords() {
  return useStoreQuery(() => store().listStudy(), [], ["study"]);
}

export function putStudyRecords(...rows: StudyRecord[]) {
  return store().putStudy(rows);
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
    });
    const fileId =
      input.bytes && input.mime
        ? await saveBlob({ notebookId, sourceId: source.id, data: input.bytes, mime: input.mime })
        : undefined;
    const book: StudyBook = {
      id: studyId(),
      kind: "book",
      notebookId,
      sourceId: source.id,
      fileId,
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

export async function renameStudyBook(book: StudyBook, title: string) {
  const current = await store().getStudy(book.id);
  const next = title.trim();
  if (!next || current?.kind !== "book") return;
  await renameNotebook(current.notebookId, next);
  await renameSource(current.sourceId, next);
  await putStudyRecords({ ...current, title: next, updatedAt: Date.now() });
}

export async function updateStudyBook(
  bookId: string,
  patch: Pick<Partial<StudyBook>, "section" | "bookmarks">,
) {
  const book = await store().getStudy(bookId);
  if (book?.kind === "book") await putStudyRecords({ ...book, ...patch, updatedAt: Date.now() });
}

export const freshSchedule = (now = Date.now()): StudySchedule => ({
  dueAt: now,
  intervalDays: 0,
  repetitions: 0,
  ease: 2.5,
});

export function nextStudySchedule(
  current: StudySchedule,
  rating: StudyRating,
  now = Date.now(),
): StudySchedule {
  if (rating === "again") {
    return {
      dueAt: now + 10 * 60_000,
      intervalDays: 0,
      repetitions: 0,
      ease: Math.max(1.3, current.ease - 0.2),
    };
  }
  const ease =
    rating === "hard"
      ? Math.max(1.3, current.ease - 0.15)
      : rating === "easy"
        ? current.ease + 0.15
        : current.ease;
  const multiplier = rating === "hard" ? 1.2 : rating === "easy" ? ease * 1.3 : ease;
  const first = rating === "easy" ? 4 : 1;
  const intervalDays =
    current.intervalDays > 0 ? Math.ceil(current.intervalDays * multiplier) : first;
  return {
    dueAt: now + intervalDays * day,
    intervalDays,
    repetitions: current.repetitions + 1,
    ease,
  };
}

export async function rateStudyItem(id: string, rating: StudyRating, seconds: number) {
  const record = await store().getStudy(id);
  const now = Date.now();
  if ((record?.kind !== "card" && record?.kind !== "highlight") || record.schedule.dueAt > now)
    return;
  await putStudyRecords(
    { ...record, schedule: nextStudySchedule(record.schedule, rating, now), updatedAt: now },
    {
      id: studyId(),
      kind: "session",
      activity: "review",
      rating,
      itemId: id,
      notebookId: record.notebookId,
      seconds: Math.max(0, Math.min(seconds, 120)),
      count: 1,
      updatedAt: now,
    },
  );
}

export async function recordStudyActivity(
  activity: "reading" | "speaking",
  seconds: number,
  notebookId?: string,
) {
  if (seconds < 1) return;
  await putStudyRecords({
    id: studyId(),
    kind: "session",
    activity,
    seconds,
    count: 1,
    notebookId,
    updatedAt: Date.now(),
  });
}

export async function saveStudyText(bookId: string, text: string) {
  const backend = store();
  const book = await backend.getStudy(bookId);
  if (book?.kind !== "book" || book.format !== "text") throw new Error("Choose a text document.");
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
