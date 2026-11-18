import { chunkText } from "@/lib/grounding/chunk";
import type { Chunk, Source } from "./types";

export function sourceHasText({ text }: Pick<Source, "text">) {
  return Boolean(text.trim());
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
