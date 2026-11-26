import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/panelui/button";
import { Dialog } from "@/components/panelui/dialog";
import { Input } from "@/components/panelui/input";
import { Select } from "@/components/panelui/select";
import { Textarea } from "@/components/panelui/textarea";
import { textDirection } from "@/lib/text/direction";
import { fullStudyImage, studyCardImage, studyImageAnchor, type StudyImageCapture } from "@/lib/study/visual-card";
import type { StudyCardEdit, StudyVisualOrigin } from "@/lib/study/records";
import { StudyImageCropEditor } from "./study-image-crop";

export type VisualFlashcard = Pick<StudyCardEdit, "front" | "back" | "image" | "backImage"> & {
  visual: StudyVisualOrigin;
};

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
  const pending = useRef(false);
  const [ready, setReady] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [side, setSide] = useState<"question" | "answer">("question");
  const [crop, setCrop] = useState(capture.crop ?? fullStudyImage);
  const [saving, setSaving] = useState(false);
  const description = capture.kind === "epub" ? capture.description : "";

  async function save() {
    if (pending.current || !front.trim() || !back.trim() || !image.current || !ready) return;
    pending.current = true;
    setSaving(true);
    try {
      const picture = studyCardImage(image.current, crop);
      if (!picture) throw new Error(t("study.visualCard.captureFailed"));
      const visual = studyImageAnchor({ ...capture, crop });
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
            <StudyImageCropEditor
              imageRef={image}
              blob={capture.blob}
              description={description || t("study.visualCard.preview")}
              crop={crop}
              setCrop={setCrop}
              ready={ready}
              onReady={() => setReady(true)}
              busy={saving}
            />
            <div className="grid gap-1.5 text-sm font-medium">
              <span>{t("study.visualCard.imageSide")}</span>
              <Select
                items={[
                  { value: "question", label: t("study.visualCard.question") },
                  { value: "answer", label: t("study.visualCard.answer") },
                ]}
                value={side}
                disabled={saving}
                onValueChange={(value) => setSide(value === "answer" ? "answer" : "question")}
              >
                <Select.Trigger aria-label={t("study.visualCard.imageSide")} className="w-fit">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="question">{t("study.visualCard.question")}</Select.Item>
                  <Select.Item value="answer">{t("study.visualCard.answer")}</Select.Item>
                </Select.Content>
              </Select>
            </div>
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
