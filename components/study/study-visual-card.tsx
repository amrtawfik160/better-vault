import { useCallback, useId, useRef, useState, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/panelui/button";
import { Dialog } from "@/components/panelui/dialog";
import { Input } from "@/components/panelui/input";
import { Textarea } from "@/components/panelui/textarea";
import { textDirection } from "@/lib/text/direction";
import { fullStudyImage, studyCardImage, type StudyImageCapture } from "@/lib/study/visual-card";
import type { StudyCardEdit, StudyVisualOrigin } from "@/lib/study/records";

const cropEdges = ["left", "top", "right", "bottom"] as const;

export type VisualFlashcard = Pick<StudyCardEdit, "front" | "back" | "image" | "backImage"> & {
  visual: StudyVisualOrigin;
};

function picturePoint(event: PointerEvent<HTMLDivElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(100, Math.round(((event.clientX - bounds.left) * 100) / bounds.width))),
    y: Math.max(0, Math.min(100, Math.round(((event.clientY - bounds.top) * 100) / bounds.height))),
  };
}

export function StudyVisualCard({
  capture,
  onClose,
  onSave,
}: {
  capture: StudyImageCapture;
  onClose: () => void;
  onSave: (card: VisualFlashcard) => Promise<void>;
}) {
  const { t } = useTranslation("home");
  const { t: common } = useTranslation();
  const id = useId();
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ pointer: number; point: ReturnType<typeof picturePoint> } | null>(null);
  const pending = useRef(false);
  const [ready, setReady] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [side, setSide] = useState<"question" | "answer">("question");
  const [cropping, setCropping] = useState(false);
  const [crop, setCrop] = useState(fullStudyImage);
  const cropped = cropEdges.some((edge) => crop[edge] !== fullStudyImage[edge]);
  const [saving, setSaving] = useState(false);
  const description = capture.kind === "epub" ? capture.description : "";

  const preview = useCallback(
    (node: HTMLImageElement | null) => {
      image.current = node;
      if (!node) return;
      const url = URL.createObjectURL(capture.blob);
      node.src = url;
      return () => {
        image.current = null;
        URL.revokeObjectURL(url);
      };
    },
    [capture.blob],
  );

  function startCrop(event: PointerEvent<HTMLDivElement>) {
    if (!cropping || !ready || saving || event.button !== 0 || !event.isPrimary) return;
    drag.current = { point: picturePoint(event), pointer: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveCrop(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointer !== event.pointerId) return;
    const start = drag.current.point;
    const end = picturePoint(event);
    if (Math.abs(start.x - end.x) < 1 || Math.abs(start.y - end.y) < 1) return;
    setCrop({
      left: Math.min(start.x, end.x),
      top: Math.min(start.y, end.y),
      right: Math.max(start.x, end.x),
      bottom: Math.max(start.y, end.y),
    });
  }

  async function save() {
    if (pending.current || !front.trim() || !back.trim() || !image.current || !ready) return;
    pending.current = true;
    setSaving(true);
    try {
      const picture = studyCardImage(image.current, crop);
      if (!picture) throw new Error(t("study.visualCard.captureFailed"));
      const visual =
        capture.kind === "epub"
          ? { kind: capture.kind, figure: capture.figure }
          : { kind: capture.kind, top: Math.round(crop.top * 100) };
      await onSave({
        front: front.trim(),
        back: back.trim(),
        ...(side === "question" ? { image: picture } : { backImage: picture }),
        visual,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open dismissible={!saving} onOpenChange={(open) => !open && !saving && onClose()}>
      <Dialog.Content size="lg" closeLabel={common("actions.close")}>
        <Dialog.Header title={t("study.visualCard.title")} />
        <Dialog.Body>
          <form
            id={id}
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="space-y-2">
              <div
                className={`relative mx-auto w-fit max-w-full overflow-hidden rounded-xl bg-muted ${cropping ? "cursor-crosshair touch-none select-none" : ""}`}
                onPointerDown={startCrop}
                onPointerMove={moveCrop}
                onPointerUp={(event) => {
                  moveCrop(event);
                  if (drag.current?.pointer === event.pointerId) drag.current = null;
                }}
                onLostPointerCapture={() => {
                  drag.current = null;
                }}
              >
                <img
                  ref={preview}
                  alt={description || t("study.visualCard.preview")}
                  draggable={false}
                  className="block max-h-[42dvh] max-w-full object-contain"
                  onLoad={() => setReady(true)}
                  onError={() => toast.error(t("study.visualCard.previewFailed"))}
                />
                {cropping || cropped ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute border-2 border-primary ring-1 [box-shadow:0_0_0_100vmax_color-mix(in_oklab,var(--background)_70%,transparent)] ring-background"
                    style={{
                      left: `${crop.left}%`,
                      top: `${crop.top}%`,
                      right: `${100 - crop.right}%`,
                      bottom: `${100 - crop.bottom}%`,
                    }}
                  />
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!ready || saving}
                  aria-expanded={cropping}
                  onClick={() => setCropping(!cropping)}
                >
                  {t("study.visualCard.crop")}
                </Button>
                {cropped ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={() => setCrop(fullStudyImage)}
                  >
                    {t("study.visualCard.reset")}
                  </Button>
                ) : null}
              </div>
              {cropping ? (
                <fieldset disabled={saving} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <legend className="mb-2 text-sm text-muted-foreground">
                    {t("study.visualCard.cropHelp")}
                  </legend>
                  {cropEdges.map((edge) => {
                    const min =
                      edge === "right" ? crop.left + 1 : edge === "bottom" ? crop.top + 1 : 0;
                    const max =
                      edge === "left" ? crop.right - 1 : edge === "top" ? crop.bottom - 1 : 100;
                    return (
                      <label key={edge} className="grid gap-1 text-sm">
                        {t(`study.visualCard.edges.${edge}`)}
                        <Input
                          type="number"
                          min={min}
                          max={max}
                          value={crop[edge]}
                          onChange={(event) => {
                            const value = event.target.valueAsNumber;
                            if (Number.isFinite(value))
                              setCrop({ ...crop, [edge]: Math.min(max, Math.max(min, value)) });
                          }}
                        />
                      </label>
                    );
                  })}
                </fieldset>
              ) : null}
            </div>
            <label className="grid gap-1.5 text-sm font-medium">
              {t("study.visualCard.imageSide")}
              <select
                value={side}
                onChange={(event) =>
                  setSide(event.target.value === "answer" ? "answer" : "question")
                }
                disabled={saving}
                className="w-fit rounded-xl border bg-background px-3 py-2 text-sm"
              >
                <option value="question">{t("study.visualCard.question")}</option>
                <option value="answer">{t("study.visualCard.answer")}</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t("study.visualCard.question")}
              <Input
                required
                value={front}
                dir={textDirection(front)}
                disabled={saving}
                onChange={(event) => setFront(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t("study.visualCard.answer")}
              <Textarea
                required
                value={back}
                dir={textDirection(back)}
                disabled={saving}
                minRows={2}
                onChange={(event) => setBack(event.target.value)}
              />
            </label>
          </form>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close render={<Button type="button" variant="secondary" disabled={saving} />}>
            {common("actions.cancel")}
          </Dialog.Close>
          <Button
            type="submit"
            form={id}
            disabled={!ready || !front.trim() || !back.trim() || saving}
          >
            {t("study.visualCard.save")}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
