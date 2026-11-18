import type { Source } from "./types";

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
