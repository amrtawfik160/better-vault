import { chunksForSource, sourceTextParts } from "@/lib/db/source-text";
import type { Chunk, Source } from "@/lib/db/types";
import { normaliseText } from "@/lib/grounding/chunk";
import { maxOcrText, ocrLanguages } from "./ocr-format";
import type { StudyBook, StudyOcrWrite, StudyRecord } from "./records";
import { studyTextEdit, studyTextRevision } from "./text-edits";

export function prepareStudyOcrWrite(row: StudyRecord | undefined, source: Source | undefined, write: StudyOcrWrite):
  { kind: "ready"; book: StudyBook; source: Source; chunks?: Chunk[] } | { kind: "conflict" | "limit" } {
  if (row?.kind !== "book" || row.format !== "pdf" || row.fileId !== write.fileId || !source ||
    source.id !== row.sourceId || source.notebookId !== row.notebookId || source.originalFileId !== row.fileId ||
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
