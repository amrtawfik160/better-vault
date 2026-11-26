import { chunkText } from "@/lib/grounding/chunk";
import type { Chunk, Source, SourceSummary } from "./types";

export function sourceHasText({ text }: Pick<Source, "text">) {
  return Boolean(text.trim());
}

/** Whether Study can open the source: it has text, or the PDF or EPUB it was read from. */
export function sourceIsReadable(source: Pick<Source, "text" | "kind" | "originalFileId">) {
  return sourceHasText(source) || ((source.kind === "pdf" || source.kind === "epub") && Boolean(source.originalFileId));
}

export function sourceSummary(source: Source): SourceSummary {
  return {
    id: source.id,
    notebookId: source.notebookId,
    title: source.title,
    kind: source.kind,
    createdAt: source.createdAt,
    hasText: sourceHasText(source),
    readable: sourceIsReadable(source),
  };
}

export function selectedTextSource(source: Pick<Source, "text" | "selected">) {
  return source.selected && sourceHasText(source);
}

export function sourceTextParts({ text, pdfOcr }: Pick<Source, "text" | "pdfOcr">) {
  if (!pdfOcr) return [text];
  return [text.slice(0, pdfOcr.baseLength), ...Object.entries(pdfOcr.pages)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, page]) => page.text)];
}

export function chunksForSource(source: Pick<Source, "id" | "notebookId" | "text" | "studyRevision" | "pdfOcr">): Chunk[] {
  const prefix = source.studyRevision ? `${source.id}:${source.studyRevision}` : source.id;
  return sourceTextParts(source).flatMap((part) => chunkText(part)).map((piece, index) => ({
    id: `${prefix}:${index}`,
    notebookId: source.notebookId,
    sourceId: source.id,
    index,
    text: piece,
  }));
}
