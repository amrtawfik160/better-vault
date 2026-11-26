import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/panelui/button";
import { Dialog } from "@/components/panelui/dialog";
import { Textarea } from "@/components/panelui/textarea";
import { saveStudyOcrText, StudyTextConflict } from "@/lib/db/study";
import { recognizeStudyPdfPage } from "@/lib/study/ocr-client";
import { maxOcrText } from "@/lib/study/ocr-format";
import type { StudySection } from "@/lib/study/records";

import { StudyOcrLanguageFields, useStudyOcrLanguages } from "./study-ocr-languages";

export function StudyPageOcr({ bookId, fileId, page, section, onClose, onSave }: {
  bookId: string;
  fileId: string;
  page: number;
  section: StudySection;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation("home");
  const { t: common } = useTranslation();
  const choice = useStudyOcrLanguages(section.ocrLanguages);
  const [draft, setDraft] = useState({ text: section.text, languages: section.ocrLanguages });
  const originalText = useRef(section.text);
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState<"recognition" | "save">();
  const [error, setError] = useState<string>();

  useEffect(() => () => request.current?.abort(), []);

  async function recognize() {
    if (!choice.codes.length || request.current || busy) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy("recognition");
    setError(undefined);
    const codes = choice.codes;
    try {
      const text = await recognizeStudyPdfPage(fileId, page, codes, controller.signal);
      if (controller.signal.aborted) return;
      if (!text.trim()) setError(t("study.scan.noText"));
      else setDraft({ text, languages: codes });
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : t("study.scan.failed"));
    } finally {
      if (!controller.signal.aborted) setBusy(undefined);
      request.current = null;
    }
  }

  async function save() {
    if (!draft.text.trim() || !draft.languages || busy) return;
    setBusy("save");
    setError(undefined);
    try {
      await saveStudyOcrText({ bookId, fileId, section: page, previousText: originalText.current, text: draft.text, languages: draft.languages });
      onSave();
    } catch (error) {
      setError(error instanceof StudyTextConflict ? t("study.reader.editConflict") :
        error instanceof Error ? error.message : t("study.scan.failed"));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <Dialog open dismissible={busy !== "save"} onOpenChange={(open) => { if (!open && busy !== "save") onClose(); }}>
      <Dialog.Content size="lg" closeLabel={common("actions.close")}>
        <Dialog.Header title={t("study.scan.title")} description={t("study.scan.description")} />
        <Dialog.Body>
          <div className="space-y-4">
            {choice.options.length ? (
              <div className="flex flex-wrap items-end gap-2.5">
                <StudyOcrLanguageFields choice={choice} disabled={!!busy} />
                <Button type="button" variant="outline" disabled={!!busy} onClick={() => void recognize()}>
                  {t(busy === "recognition" ? "study.scan.recognizing" : "study.scan.recognize")}
                </Button>
              </div>
            ) : (
              <p role="status" className="text-sm text-muted-foreground">
                {choice.fallback}
              </p>
            )}
            {draft.languages ? (
              <label className="grid gap-1.5 text-sm">
                {t("study.scan.review")}
                <Textarea dir="auto" minRows={7} maxRows={15} value={draft.text} maxLength={maxOcrText}
                  disabled={!!busy} onChange={(event) => setDraft({ ...draft, text: event.target.value })} />
              </label>
            ) : null}
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </div>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close render={<Button type="button" variant="secondary" disabled={busy === "save"} />}>
            {common("actions.cancel")}
          </Dialog.Close>
          <Button type="button" disabled={!draft.languages || !draft.text.trim() || !!busy} onClick={() => void save()}>
            {t("study.scan.save")}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
