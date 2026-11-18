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

async function renderPdfPage(fileId: string, section: number, signal: AbortSignal) {
  const blob = await loadBlob(fileId);
  if (!blob) throw new Error("The original PDF is unavailable.");
  signal.throwIfAborted();
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()));
  try {
    signal.throwIfAborted();
    const page = await pdf.getPage(section + 1);
    const original = page.getViewport({ scale: 1 });
    const scale = Math.min(3, maxOcrSide / Math.max(original.width, original.height),
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
    }
  } finally {
    await pdf.loadingTask.destroy();
  }
}

export async function recognizeStudyPdfPage(fileId: string, section: number, languages: string[], signal: AbortSignal) {
  const png = await renderPdfPage(fileId, section, signal);
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
