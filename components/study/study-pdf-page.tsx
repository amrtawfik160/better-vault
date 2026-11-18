import { useEffect, useRef, useState } from "react";
import { loadBlob } from "@/lib/db/blobs";
import { useRenderedStudyMarks, type StudyTextMark } from "./study-rendered-text";
import "./study-pdf-page.css";

export function StudyPdfPage({
  fileId,
  page,
  sectionText,
  marks,
  zoom,
  onSelect,
  onReadingSurface,
}: {
  fileId: string;
  page: number;
  sectionText: string;
  marks: readonly StudyTextMark[];
  zoom: number;
  onSelect: (root: HTMLElement) => void;
  onReadingSurface: (surface: { section: number; root: HTMLElement | null }) => void;
}) {
  const paper = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [drawFailed, setDrawFailed] = useState(false);
  const [ready, setReady] = useState(false);
  useRenderedStudyMarks(text, ready, sectionText, marks);
  useEffect(() => {
    if (ready || drawFailed) onReadingSurface({ section: page, root: text.current });
  }, [drawFailed, onReadingSurface, page, ready]);

  useEffect(() => {
    const frame = paper.current;
    const image = canvas.current;
    const overlay = text.current;
    if (!frame || !image || !overlay) return;

    let live = true;
    let destroy: (() => Promise<void>) | undefined;
    let cancel: (() => void) | undefined;
    let size: ResizeObserver | undefined;

    void (async () => {
      const blob = await loadBlob(fileId);
      if (!live) return;
      if (!blob) throw new Error("PDF file is missing.");
      const { getDocumentProxy, getResolvedPDFJS } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()));
      destroy = () => pdf.loadingTask.destroy();
      if (!live) {
        await destroy();
        return;
      }

      const current = await pdf.getPage(page + 1);
      const { TextLayer } = await getResolvedPDFJS();
      if (!live) return;
      const viewport = current.getViewport({ scale: 1.3 });
      image.width = Math.ceil(viewport.width);
      image.height = Math.ceil(viewport.height);
      frame.style.setProperty("--study-page-width", `${viewport.width}px`);
      function scaleText() {
        if (!frame || !overlay) return;
        const scale = (frame.clientWidth / viewport.width) * viewport.scale;
        overlay.style.setProperty("--total-scale-factor", String(scale));
      }
      size = new ResizeObserver(scaleText);
      size.observe(frame);
      scaleText();

      const layer = new TextLayer({
        textContentSource: current.streamTextContent(),
        container: overlay,
        viewport,
      });
      const drawing = current.render({ canvas: image, viewport });
      cancel = () => {
        layer.cancel();
        drawing.cancel();
      };

      await Promise.all([drawing.promise, layer.render()]);
      if (live) setReady(true);
    })().catch(() => {
      if (live) setDrawFailed(true);
    });

    return () => {
      live = false;
      size?.disconnect();
      cancel?.();
      overlay.replaceChildren();
      void destroy?.().catch(() => {});
    };
  }, [fileId, page]);

  if (drawFailed) {
    return (
      <p className="text-sm text-muted-foreground">
        The original PDF page could not be displayed. Its extracted text is below.
      </p>
    );
  }

  function capture() {
    if (text.current) onSelect(text.current);
  }

  return (
    <div className="overflow-auto">
      <div
        ref={paper}
        className="relative mx-auto overflow-hidden rounded-lg border bg-white"
        style={{
          width: `calc(var(--study-page-width, 800px) * ${zoom / 100})`,
          maxWidth: `${zoom}%`,
        }}
      >
        <canvas
          ref={canvas}
          className="block h-auto w-full"
          role="img"
          aria-label={`Original PDF page ${page + 1}`}
        />
        <div
          ref={text}
          role="region"
          aria-label="Selectable PDF text"
          className="study-pdf-text"
          onMouseUp={capture}
          onTouchEnd={capture}
          onKeyUp={capture}
        />
      </div>
    </div>
  );
}
