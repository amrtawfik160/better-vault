import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "@/components/panelui/select";
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
  const primary = choice.options.map(({ code, name }) => ({ value: code, label: name }));
  const additional = [
    { value: "", label: t("study.scan.singleLanguage") },
    ...primary.filter(({ value }) => value !== choice.chosen),
  ];
  return (
    <>
      <div className="grid min-w-0 flex-1 gap-1 text-sm">
        <span>{t("study.scan.language")}</span>
        <Select
          items={primary}
          value={choice.chosen}
          disabled={disabled}
          onValueChange={(value) => typeof value === "string" && choice.setPrimary(value)}
        >
          <Select.Trigger aria-label={t("study.scan.language")} className="w-full">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {primary.map(({ value, label }) => (
              <Select.Item key={value} value={value}>
                {label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
      <div className="grid min-w-0 flex-1 gap-1 text-sm">
        <span>{t("study.scan.additionalLanguage")}</span>
        <Select
          items={additional}
          value={choice.secondary}
          disabled={disabled}
          onValueChange={(value) => typeof value === "string" && choice.setAdditional(value)}
        >
          <Select.Trigger aria-label={t("study.scan.additionalLanguage")} className="w-full">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {additional.map(({ value, label }) => (
              <Select.Item key={value} value={value}>
                {label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
    </>
  );
}
