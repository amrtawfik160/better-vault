import { useCallback, useRef, useState, type PointerEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import type { StudyImageCrop } from "@/lib/study/records";
import { fullStudyImage, isCroppedStudyImage } from "@/lib/study/visual-card";

const cropEdges = ["left", "top", "right", "bottom"] as const;

function picturePoint(event: PointerEvent<HTMLDivElement>, bounds: DOMRect) {
  return {
    x: Math.max(0, Math.min(100, Math.round(((event.clientX - bounds.left) * 100) / bounds.width))),
    y: Math.max(0, Math.min(100, Math.round(((event.clientY - bounds.top) * 100) / bounds.height))),
  };
}

export function StudyImageRegion({ crop, shade = false }: { crop: StudyImageCrop; shade?: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-study-image-region={shade ? undefined : ""}
      className={`pointer-events-none absolute z-10 border-2 border-primary ring-1 ring-background ${shade ? "[box-shadow:0_0_0_100vmax_color-mix(in_oklab,var(--background)_70%,transparent)]" : "bg-primary/10"}`}
      style={{
        left: `${crop.left}%`,
        top: `${crop.top}%`,
        right: `${100 - crop.right}%`,
        bottom: `${100 - crop.bottom}%`,
      }}
    />
  );
}

export function StudyImageCropEditor({
  blob,
  description,
  imageRef,
  crop,
  setCrop,
  ready,
  onReady,
  busy,
  alwaysEditable = false,
}: {
  blob: Blob;
  description: string;
  imageRef?: RefObject<HTMLImageElement | null>;
  crop: StudyImageCrop;
  setCrop: (crop: StudyImageCrop) => void;
  ready: boolean;
  onReady: () => void;
  busy: boolean;
  alwaysEditable?: boolean;
}) {
  const { t } = useTranslation("home");
  const drag = useRef<{ pointer: number; bounds: DOMRect; point: ReturnType<typeof picturePoint> } | null>(null);
  const [cropping, setCropping] = useState(alwaysEditable);
  const cropped = isCroppedStudyImage(crop);

  const preview = useCallback((node: HTMLImageElement | null) => {
    if (imageRef) imageRef.current = node;
    if (!node) return;
    const url = URL.createObjectURL(blob);
    node.src = url;
    return () => {
      if (imageRef) imageRef.current = null;
      URL.revokeObjectURL(url);
    };
  }, [blob, imageRef]);

  function startCrop(event: PointerEvent<HTMLDivElement>) {
    if (!cropping || !ready || busy || event.button !== 0 || !event.isPrimary) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    drag.current = { bounds, point: picturePoint(event, bounds), pointer: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveCrop(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointer !== event.pointerId) return;
    const start = drag.current.point;
    const end = picturePoint(event, drag.current.bounds);
    if (Math.abs(start.x - end.x) < 1 || Math.abs(start.y - end.y) < 1) return;
    setCrop({
      left: Math.min(start.x, end.x),
      top: Math.min(start.y, end.y),
      right: Math.max(start.x, end.x),
      bottom: Math.max(start.y, end.y),
    });
  }

  return (
    <div className="space-y-2">
      <div
        className={`relative mx-auto w-fit max-w-full overflow-hidden rounded-xl bg-muted ${cropping ? "cursor-crosshair touch-none select-none" : ""}`}
        onPointerDown={startCrop}
        onPointerMove={moveCrop}
        onPointerUp={(event) => {
          moveCrop(event);
          if (drag.current?.pointer === event.pointerId) drag.current = null;
        }}
        onLostPointerCapture={() => { drag.current = null; }}
      >
        <img
          ref={preview}
          alt={description}
          draggable={false}
          className="block max-h-[42dvh] max-w-full object-contain"
          onLoad={onReady}
          onError={() => toast.error(t("study.visualCard.previewFailed"))}
        />
        {cropping || cropped ? <StudyImageRegion crop={crop} shade /> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {!alwaysEditable ? (
          <Button type="button" variant="outline" size="sm" disabled={!ready || busy} aria-expanded={cropping} onClick={() => setCropping(!cropping)}>
            {t("study.visualCard.crop")}
          </Button>
        ) : null}
        {alwaysEditable || cropped ? (
          <Button type="button" variant="ghost" size="sm" disabled={!cropped || busy} onClick={() => setCrop(fullStudyImage)}>
            {t("study.visualCard.reset")}
          </Button>
        ) : null}
      </div>
      {cropping ? (
        <fieldset disabled={!ready || busy} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <legend className="mb-2 text-sm text-muted-foreground">{t("study.visualCard.cropHelp")}</legend>
          {cropEdges.map((edge) => {
            const min = edge === "right" ? crop.left + 1 : edge === "bottom" ? crop.top + 1 : 0;
            const max = edge === "left" ? crop.right - 1 : edge === "top" ? crop.bottom - 1 : 100;
            return (
              <label key={edge} className="grid gap-1 text-sm">
                {t(`study.visualCard.edges.${edge}`)}
                <Input type="number" min={min} max={max} value={crop[edge]} onChange={(event) => {
                  const value = event.target.valueAsNumber;
                  if (Number.isFinite(value)) setCrop({ ...crop, [edge]: Math.min(max, Math.max(min, Math.round(value))) });
                }} />
              </label>
            );
          })}
        </fieldset>
      ) : null}
    </div>
  );
}
