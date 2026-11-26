import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/panelui/button";
import { DirectionalText } from "@/components/common/directional-text";
import { textDirection } from "@/lib/text/direction";
import type { StudyOrigin, StudyReport } from "@/lib/study/records";
import { studyReportKey } from "@/lib/study/reports";
import { StudyOriginLink } from "./study-origin-link";
import { StudyText } from "./study-text";

function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2 border-t pt-3">
      <h4 className="text-sm font-semibold">{title}</h4>
      {children}
    </div>
  );
}

type Vocabulary = NonNullable<StudyReport["vocabulary"]>[number];

export function StudySessionReport({
  report,
  savedSuggestions,
  onSaveCard,
  onDraftCard,
  onSaveWord,
  onSaveNote,
  onFeedback,
  onPlanStep,
  practiceStep,
  actions,
}: {
  report: StudyReport;
  savedSuggestions: ReadonlyMap<string, StudyOrigin>;
  onSaveCard: (front: string, back: string, key: string) => Promise<unknown>;
  onDraftCard: (feedback: string) => void;
  onSaveWord: (word: Vocabulary, key: string) => Promise<unknown>;
  onSaveNote: () => void;
  onFeedback: (key: string, value: boolean) => void;
  onPlanStep: (index: number, action: "plan" | "remove" | "reopen") => void;
  practiceStep: (index: number, description: string) => ReactNode;
  actions?: ReactNode;
}) {
  const { t } = useTranslation("home");
  const nextStepId = useId();
  const [saving, setSaving] = useState(new Set<string>());
  const technical = [
    ...(report.technicalFeedback ?? []).map(({ text }) => text),
    ...report.corrections,
  ];
  const language = report.languageFeedback ?? [];
  const words = report.vocabulary ?? [];

  function suggestionAction(key: string, save: () => Promise<unknown>, label: string) {
    const origin = savedSuggestions.get(key);
    if (origin) {
      return (
        <StudyOriginLink
          origin={origin}
          label={t(origin.kind === "word" ? "study.vocabulary.open" : "study.followUps.openCard")}
          tutorFocus={{ report: { id: studyReportKey(report), suggestion: key } }}
        />
      );
    }
    return (
      <Button
        variant="outline"
        size="sm"
        loading={saving.has(key)}
        onClick={async ({ currentTarget }) => {
          currentTarget.closest("li")?.focus({ preventScroll: true });
          setSaving((current) => new Set(current).add(key));
          try {
            await save();
          } finally {
            setSaving((current) => new Set([...current].filter((item) => item !== key)));
          }
        }}
      >
        {label}
      </Button>
    );
  }

  function feedback(key: string) {
    return (
      <span role="group" aria-label="Feedback on this suggestion" className="flex flex-wrap gap-1">
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={report.feedback?.[key] === true}
          onClick={() => onFeedback(key, true)}
        >
          Helpful
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={report.feedback?.[key] === false}
          onClick={() => onFeedback(key, false)}
        >
          Unhelpful
        </Button>
      </span>
    );
  }

  return (
    <div
      id="study-session-report"
      tabIndex={-1}
      className="scroll-mt-32 space-y-4 rounded-2xl border bg-card p-4 outline-none"
    >
      <h3 className="font-semibold">Session report</h3>
      <StudyText text={report.summary} />
      {actions}
      {technical.length > 0 ? (
        <ReportSection title="Technical feedback">
          <ul className="space-y-2">
            {technical.map((text, index) => (
              <li key={index} className="space-y-1 rounded-xl border p-3">
                <StudyText text={text} className="text-sm" />
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => onDraftCard(text)}>
                    {t("study.capture.draftFromFeedback")}
                  </Button>
                  {feedback(`technical-${index}`)}
                </div>
              </li>
            ))}
          </ul>
        </ReportSection>
      ) : null}
      {language.length > 0 ? (
        <ReportSection title="Language feedback">
          <ul className="space-y-2">
            {language.map((item, index) => (
              <li
                key={index}
                id={`study-report-language-${index}`}
                tabIndex={-1}
                className="scroll-mt-32 space-y-2 rounded-xl border p-3 text-sm focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p>
                  <span className="text-muted-foreground">Original </span>
                  <DirectionalText as="span" text={item.original} />
                </p>
                <p>
                  <span className="text-muted-foreground">Try </span>
                  <strong>
                    <DirectionalText as="span" text={item.suggestion} />
                  </strong>
                </p>
                <DirectionalText multiline text={item.reason} className="text-muted-foreground" />
                <div className="flex flex-wrap gap-2">
                  {suggestionAction(
                    `language-${index}`,
                    () =>
                      onSaveCard(
                        item.original,
                        `${item.suggestion}\n\n${item.reason}`,
                        `language-${index}`,
                      ),
                    t("study.followUps.saveCard"),
                  )}
                  {feedback(`language-${index}`)}
                </div>
              </li>
            ))}
          </ul>
        </ReportSection>
      ) : report.languageStatus === "insufficient" ? (
        <p className="text-sm text-muted-foreground">
          Add a few more replies in your own words to get language feedback.
        </p>
      ) : null}
      {words.length > 0 ? (
        <ReportSection title="Suggested vocabulary">
          <ul className="space-y-2">
            {words.map((word, index) => (
              <li
                key={index}
                id={`study-report-word-${index}`}
                tabIndex={-1}
                className="scroll-mt-32 space-y-2 rounded-xl border p-3 text-sm focus-visible:ring-2 focus-visible:ring-ring"
              >
                <strong dir={textDirection(word.term)}>{word.term}</strong>
                <DirectionalText multiline text={word.definition} />
                {word.translation ? <DirectionalText text={word.translation} /> : null}
                {word.example ? (
                  <DirectionalText
                    multiline
                    text={word.example}
                    className="text-muted-foreground"
                  />
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {suggestionAction(
                    `word-${index}`,
                    () => onSaveWord(word, `word-${index}`),
                    t("study.followUps.saveWord"),
                  )}
                  {feedback(`word-${index}`)}
                </div>
              </li>
            ))}
          </ul>
        </ReportSection>
      ) : null}
      {report.nextSteps.some((text) => text.trim()) ? (
        <ReportSection title={t("study.followUps.nextSteps")}>
          <ul className="divide-y rounded-xl border px-3 text-sm">
            {report.nextSteps.map((text, index) => {
              if (!text.trim()) return null;
              const state = report.plannedSteps?.[index];
              const done = state?.completedAt !== undefined;
              const action = done ? "reopen" : state ? "remove" : "plan";
              const label = done ? "reopen" : state ? "remove" : "add";
              const id = `${nextStepId}-${index}`;
              return (
                <li key={index} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <DirectionalText
                    id={id}
                    text={text}
                    className="min-w-0 basis-full wrap-break-word sm:flex-1"
                  />
                  {done ? (
                    <span className="text-muted-foreground">{t("study.followUps.done")}</span>
                  ) : null}
                  {state && !done ? practiceStep(index, id) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    aria-describedby={id}
                    onClick={() => onPlanStep(index, action)}
                  >
                    {t(`study.followUps.${label}`)}
                  </Button>
                </li>
              );
            })}
          </ul>
        </ReportSection>
      ) : null}
      <Button variant="outline" size="sm" onClick={onSaveNote}>
        Save report to Notes
      </Button>
    </div>
  );
}
