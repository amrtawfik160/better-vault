import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/panelui/button";
import { DirectionalText } from "@/components/common/directional-text";
import { textDirection } from "@/lib/text/direction";
import type { StudyReport } from "@/lib/study/records";

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
  onSaveCard: (front: string, back: string, key: string) => void;
  onDraftCard: (feedback: string) => void;
  onSaveWord: (word: Vocabulary, key: string) => void;
  onSaveNote: () => void;
  onFeedback: (key: string, value: boolean) => void;
  onPlanStep: (index: number, action: "plan" | "remove" | "reopen") => void;
  practiceStep: (index: number, description: string) => ReactNode;
  actions?: ReactNode;
}) {
  const { t } = useTranslation("home");
  const nextStepId = useId();
  const technical = [
    ...(report.technicalFeedback ?? []).map(({ text }) => text),
    ...report.corrections,
  ];
  const language = report.languageFeedback ?? [];
  const words = report.vocabulary ?? [];

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
      className="scroll-mt-32 space-y-4 rounded-2xl border bg-card p-4"
    >
      <h3 className="font-semibold">Session report</h3>
      <DirectionalText multiline text={report.summary} className="whitespace-pre-wrap" />
      {actions}
      {technical.length > 0 ? (
        <ReportSection title="Technical feedback">
          <ul className="space-y-2">
            {technical.map((text, index) => (
              <li key={index} className="space-y-1 rounded-xl border p-3">
                <DirectionalText multiline text={text} className="text-sm" />
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
              <li key={index} className="space-y-2 rounded-xl border p-3 text-sm">
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      onSaveCard(
                        item.original,
                        `${item.suggestion}\n\n${item.reason}`,
                        `language-${index}`,
                      )
                    }
                  >
                    Save flashcard
                  </Button>
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
              <li key={index} className="space-y-2 rounded-xl border p-3 text-sm">
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onSaveWord(word, `word-${index}`)}
                  >
                    Save vocabulary
                  </Button>
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
