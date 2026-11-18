import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/panelui/button";
import { Dialog } from "@/components/panelui/dialog";
import { Textarea } from "@/components/panelui/textarea";
import { saveStudyOcrText, StudyTextConflict } from "@/lib/db/study";
import { getStudyOcrStatus, recognizeStudyPdfPage, type StudyOcrStatus } from "@/lib/study/ocr-client";
import { maxOcrText } from "@/lib/study/ocr-format";
import type { StudySection } from "@/lib/study/records";

function languageName(code: string, names: Intl.DisplayNames) {
  const [language, ...variant] = code.split("_");
  const base = names.of(language) ?? language;
  return variant.length ? `${base} (${variant.join(" ")})` : base;
}

export function StudyPageOcr({ bookId, fileId, page, section, onClose, onSave }: {
  bookId: string;
  fileId: string;
  page: number;
  section: StudySection;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t, i18n } = useTranslation("home");
  const { t: common } = useTranslation();
  const [status, setStatus] = useState<StudyOcrStatus>();
  const [statusFailed, setStatusFailed] = useState(false);
  const [primary, setPrimary] = useState(section.ocrLanguages?.[0] ?? "");
  const [additional, setAdditional] = useState(section.ocrLanguages?.[1] ?? "");
  const [draft, setDraft] = useState({ text: section.text, languages: section.ocrLanguages });
  const originalText = useRef(section.text);
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState<"recognition" | "save">();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void getStudyOcrStatus(controller.signal).then((available) => {
      if (!controller.signal.aborted) setStatus(available);
    }).catch(() => {
      if (!controller.signal.aborted) setStatusFailed(true);
    });
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, []);

  const display = new Intl.DisplayNames(i18n.language, { type: "language" });
  const options = (status?.languages ?? []).map((code) => ({ code, name: languageName(code, display) }))
    .sort((a, b) => a.name.localeCompare(b.name, i18n.language));
  const languages = status?.languages ?? [];
  const chosen = languages.includes(primary) ? primary :
    languages.includes("eng") ? "eng" : options[0]?.code ?? "";
  const secondary = additional !== chosen && languages.includes(additional) ? additional : "";

  async function recognize() {
    if (!chosen || request.current || busy) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy("recognition");
    setError(undefined);
    const codes = secondary ? [chosen, secondary] : [chosen];
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
            {options.length ? (
              <div className="flex flex-wrap items-end gap-2.5">
                <label className="grid min-w-0 flex-1 gap-1 text-sm">
                  {t("study.scan.language")}
                  <select value={chosen} disabled={!!busy} onChange={(event) => setPrimary(event.target.value)} className="w-full rounded-lg border bg-background p-2">
                    {options.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
                  </select>
                </label>
                <label className="grid min-w-0 flex-1 gap-1 text-sm">
                  {t("study.scan.additionalLanguage")}
                  <select value={secondary} disabled={!!busy} onChange={(event) => setAdditional(event.target.value)} className="w-full rounded-lg border bg-background p-2">
                    <option value="">{t("study.scan.singleLanguage")}</option>
                    {options.filter(({ code }) => code !== chosen).map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
                  </select>
                </label>
                <Button type="button" variant="outline" disabled={!!busy} onClick={() => void recognize()}>
                  {t(busy === "recognition" ? "study.scan.recognizing" : "study.scan.recognize")}
                </Button>
              </div>
            ) : (
              <p role="status" className="text-sm text-muted-foreground">
                {t(statusFailed ? "study.scan.statusFailed" : !status ? "study.scan.checking" :
                  status.local ? "study.scan.install" : "study.scan.localOnly")}
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
