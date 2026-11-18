import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getStudyOcrStatus, type StudyOcrStatus } from "@/lib/study/ocr-client";

function languageName(code: string, names: Intl.DisplayNames) {
  const [language, ...variant] = code.split("_");
  const base = names.of(language) ?? language;
  return variant.length ? `${base} (${variant.join(" ")})` : base;
}

export function useStudyOcrLanguages(initial?: string[]) {
  const { t, i18n } = useTranslation("home");
  const [status, setStatus] = useState<StudyOcrStatus>();
  const [failed, setFailed] = useState(false);
  const [primary, setPrimary] = useState(initial?.[0] ?? "");
  const [additional, setAdditional] = useState(initial?.[1] ?? "");

  useEffect(() => {
    const controller = new AbortController();
    void getStudyOcrStatus(controller.signal).then((available) => {
      if (!controller.signal.aborted) setStatus(available);
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, []);

  const options = useMemo(() => {
    const display = new Intl.DisplayNames(i18n.language, { type: "language" });
    return (status?.languages ?? []).map((code) => ({ code, name: languageName(code, display) }))
      .sort((a, b) => a.name.localeCompare(b.name, i18n.language));
  }, [i18n.language, status]);
  const available = status?.languages ?? [];
  const chosen = available.includes(primary) ? primary : available.includes("eng") ? "eng" : options[0]?.code ?? "";
  const secondary = additional !== chosen && available.includes(additional) ? additional : "";
  const fallback = t(failed ? "study.scan.statusFailed" : !status ? "study.scan.checking" :
    status.local ? "study.scan.install" : "study.scan.localOnly");
  return { options, chosen, secondary, setPrimary, setAdditional, fallback,
    codes: chosen ? (secondary ? [chosen, secondary] : [chosen]) : [] };
}

export function StudyOcrLanguageFields({ choice, disabled }: {
  choice: ReturnType<typeof useStudyOcrLanguages>;
  disabled: boolean;
}) {
  const { t } = useTranslation("home");
  return (
    <>
      <label className="grid min-w-0 flex-1 gap-1 text-sm">
        {t("study.scan.language")}
        <select value={choice.chosen} disabled={disabled} onChange={(event) => choice.setPrimary(event.target.value)} className="w-full rounded-lg border bg-background p-2">
          {choice.options.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
        </select>
      </label>
      <label className="grid min-w-0 flex-1 gap-1 text-sm">
        {t("study.scan.additionalLanguage")}
        <select value={choice.secondary} disabled={disabled} onChange={(event) => choice.setAdditional(event.target.value)} className="w-full rounded-lg border bg-background p-2">
          <option value="">{t("study.scan.singleLanguage")}</option>
          {choice.options.filter(({ code }) => code !== choice.chosen).map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
        </select>
      </label>
    </>
  );
}
