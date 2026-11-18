import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/panelui/button";
import { Dialog } from "@/components/panelui/dialog";
import { fullStudyImage, isCroppedStudyImage, type StudyImageCapture } from "@/lib/study/visual-card";
import { StudyImageCropEditor } from "./study-image-crop";

export function StudyImageDiscussion({
  capture,
  onClose,
  onStart,
}: {
  capture: StudyImageCapture;
  onClose: () => void;
  onStart: (capture: StudyImageCapture) => Promise<boolean>;
}) {
  const { t } = useTranslation("home");
  const { t: common } = useTranslation();
  const pending = useRef(false);
  const [crop, setCrop] = useState(fullStudyImage);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const canStart = ready && isCroppedStudyImage(crop) && !busy;
  const description = capture.kind === "epub" ? capture.description : undefined;

  async function start() {
    if (!canStart || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      if (await onStart({ ...capture, crop })) onClose();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open dismissible={!busy} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <Dialog.Content size="lg" closeLabel={common("actions.close")}>
        <Dialog.Header title={t("study.reader.discussArea")} />
        <Dialog.Body>
          <StudyImageCropEditor
            blob={capture.blob}
            description={description || t("study.reader.areaPreview")}
            crop={crop}
            setCrop={setCrop}
            ready={ready}
            onReady={() => setReady(true)}
            busy={busy}
            alwaysEditable
          />
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close render={<Button type="button" variant="secondary" disabled={busy} />}>
            {common("actions.cancel")}
          </Dialog.Close>
          <Button type="button" disabled={!canStart} onClick={() => void start()}>
            {t("study.reader.tutorSelection")}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
