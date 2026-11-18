import { chunksForSource, sourceTextParts } from "@/lib/db/source-text";
import type { Chunk, Source } from "@/lib/db/types";
import { normaliseText } from "@/lib/grounding/chunk";
import { maxOcrText, ocrLanguages } from "./ocr-format";
import { studyOcrDraftPages, type StudyBook, type StudyOcrDraft, type StudyOcrDraftWrite, type StudyOcrWrite, type StudyRecord } from "./records";
import { studyTextEdit, studyTextRevision } from "./text-edits";

export function scanDraftId(bookId: string) {
  return `ocr-draft:${bookId}`;
}

function matchesOriginal(book: StudyRecord | undefined, source: Source | undefined, fileId: string): book is StudyBook {
  return book?.kind === "book" && book.format === "pdf" && book.fileId === fileId &&
    source?.id === book.sourceId && source.notebookId === book.notebookId && source.originalFileId === fileId;
}

export function prepareStudyOcrDraft(book: StudyRecord | undefined, source: Source | undefined,
  existing: StudyRecord | undefined, write: StudyOcrDraftWrite): StudyOcrDraft | undefined {
  if (!matchesOriginal(book, source, write.fileId) || (existing && existing.kind !== "ocr-draft") ||
    existing?.version !== write.replaces) return;
  const pages = studyOcrDraftPages.safeParse(write.pages).data;
  if (!pages || new Set(pages.map(({ section }) => section)).size !== pages.length ||
    pages.some(({ section, previousText }) => previousText.trim() || book.sections[section]?.text !== previousText)) return;
  return { id: scanDraftId(book.id), kind: "ocr-draft", notebookId: book.notebookId,
    bookId: book.id, fileId: write.fileId, version: write.version, pages, updatedAt: write.updatedAt };
}

export function remainingStudyOcrDraft(draft: StudyRecord | undefined, write: StudyOcrWrite) {
  const current = draft?.kind === "ocr-draft" && draft.fileId === write.fileId ? draft : undefined;
  const selected = new Map(write.pages.map((page) => [page.section, page]));
  const selectedDrafts = current?.pages.filter(({ section }) => selected.has(section)) ?? [];
  if (write.draftVersion === undefined) return { allowed: selectedDrafts.length === 0 };
  if (!current || current.version !== write.draftVersion || selectedDrafts.length !== write.pages.length ||
    selectedDrafts.some((draftPage) => {
      const page = selected.get(draftPage.section);
      return !draftPage.reviewed || page?.text !== draftPage.text || page.previousText !== draftPage.previousText ||
        page.languages.join("+") !== draftPage.languages.join("+");
    })) return { allowed: false };
  return { allowed: true, remaining: { ...current, pages: current.pages.filter(({ section }) => !selected.has(section)) } };
}

export function prepareStudyOcrWrite(row: StudyRecord | undefined, source: Source | undefined, write: StudyOcrWrite):
  { kind: "ready"; book: StudyBook; source: Source; chunks?: Chunk[] } | { kind: "conflict" | "limit" } {
  if (!source || !matchesOriginal(row, source, write.fileId) ||
    (source.studyRevision ?? 0) !== studyTextRevision(row) || !write.pages.length)
    return { kind: "conflict" };

  const sections = [...row.sections];
  const edits = [...(row.textEdits ?? [])];
  const pages = { ...source.pdfOcr?.pages };
  const seen = new Set<number>();
  let length = sections.reduce((size, section) => size + section.text.length, 0);
  for (const { section, previousText, text, languages } of write.pages) {
    const previous = sections[section];
    if (!previous || seen.has(section) || previous.text !== previousText ||
      (previous.text.trim() && !previous.ocrLanguages)) return { kind: "conflict" };
    const codes = ocrLanguages.safeParse([...new Set(languages)]).data;
    if (!codes) return { kind: "conflict" };
    const body = normaliseText(text);
    if (!body || body.length > maxOcrText) return { kind: "limit" };
    seen.add(section);
    length += body.length - previousText.length;
    if (body !== previousText) edits.push(studyTextEdit(section, previousText, body));
    sections[section] = { ...previous, text: body, ocrLanguages: codes };
    pages[section] = { text: body, languages: codes };
  }
  if (length > 2_000_000) return { kind: "limit" };

  const book = { ...row, sections, textEdits: edits, updatedAt: Math.max(row.updatedAt, write.updatedAt) };
  const pdfOcr = { baseLength: source.pdfOcr?.baseLength ?? source.text.length, pages, edits };
  // Keep the original notebook text and its image offsets before the recognized pages.
  const text = normaliseText(sourceTextParts({ ...source, pdfOcr }).join("\n\n"));
  const indexed = { ...source, text, charCount: text.length, selected: source.selected || !source.text.trim(), studyRevision: edits.length, pdfOcr };
  return { kind: "ready", book, source: indexed,
    chunks: edits.length === studyTextRevision(row) ? undefined : chunksForSource(indexed) };
}
