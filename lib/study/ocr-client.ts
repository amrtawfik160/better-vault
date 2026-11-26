import { z } from "zod";
import { loadBlob } from "@/lib/db/blobs";
import { maxOcrPixels, maxOcrSide, maxOcrText, ocrLanguage } from "./ocr-format";

const ocrStatus = z.object({ local: z.boolean(), languages: z.array(ocrLanguage) });
export type StudyOcrStatus = z.infer<typeof ocrStatus>;

export async function getStudyOcrStatus(signal: AbortSignal) {
  const response = await fetch("/api/study/ocr", { signal });
  if (!response.ok) throw new Error("Could not check text recognition.");
  return ocrStatus.parse(await response.json());
}

type StudyPdf = Awaited<ReturnType<typeof import("unpdf").getDocumentProxy>>;

async function withStudyPdf<T>(fileId: string, signal: AbortSignal, work: (pdf: StudyPdf) => Promise<T>) {
  const blob = await loadBlob(fileId);
  if (!blob) throw new Error("The original PDF is unavailable.");
  signal.throwIfAborted();
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()));
  try {
    signal.throwIfAborted();
    return await work(pdf);
  } finally {
    await pdf.loadingTask.destroy();
  }
}

async function renderPdfPage(pdf: StudyPdf, section: number, signal: AbortSignal, side = maxOcrSide) {
  signal.throwIfAborted();
  const page = await pdf.getPage(section + 1);
  const original = page.getViewport({ scale: 1 });
  const scale = Math.min(3, side / Math.max(original.width, original.height),
    Math.sqrt(maxOcrPixels / (original.width * original.height)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  signal.throwIfAborted();
  const render = page.render({ canvas, viewport, background: "white" });
  const cancel = () => render.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await render.promise;
    signal.throwIfAborted();
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (png) return png;
    throw new Error("Could not prepare the page image.");
  } finally {
    signal.removeEventListener("abort", cancel);
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
  }
}

async function recognizePage(pdf: StudyPdf, section: number, languages: string[], signal: AbortSignal) {
  const png = await renderPdfPage(pdf, section, signal);
  const response = await fetch("/api/study/ocr", {
    method: "POST",
    headers: { "content-type": "image/png", "x-study-ocr-language": languages.join("+") },
    body: png,
    signal,
  });
  const result = z.object({ text: z.string().max(maxOcrText).optional(), error: z.string().optional() })
    .parse(await response.json());
  if (!response.ok || result.text === undefined) throw new Error(result.error ?? "Could not recognize this page.");
  return result.text;
}

export function recognizeStudyPdfPage(fileId: string, section: number, languages: string[], signal: AbortSignal) {
  return withStudyPdf(fileId, signal, (pdf) => recognizePage(pdf, section, languages, signal));
}

export type StudyOcrBatchEvent =
  | { kind: "started"; section: number; done: number; total: number }
  | { kind: "result"; section: number; text: string }
  | { kind: "error"; section: number; message: string };

export function recognizeStudyPdfPages(fileId: string, sections: number[], languages: string[], signal: AbortSignal,
  onEvent: (event: StudyOcrBatchEvent) => void) {
  return withStudyPdf(fileId, signal, async (pdf) => {
    for (const [done, section] of sections.entries()) {
      signal.throwIfAborted();
      onEvent({ kind: "started", section, done, total: sections.length });
      try {
        const text = await recognizePage(pdf, section, languages, signal);
        signal.throwIfAborted();
        onEvent({ kind: "result", section, text });
      } catch (error) {
        signal.throwIfAborted();
        onEvent({ kind: "error", section, message: error instanceof Error ? error.message : "" });
      }
    }
  });
}

export function renderStudyOcrPreview(fileId: string, section: number, signal: AbortSignal) {
  return withStudyPdf(fileId, signal, (pdf) => renderPdfPage(pdf, section, signal, 1000));
}
