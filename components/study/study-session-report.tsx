import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/panelui/button";
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
}: {
  report: StudyReport;
  onSaveCard: (front: string, back: string, key: string) => void;
  onDraftCard: (feedback: string) => void;
  onSaveWord: (word: Vocabulary, key: string) => void;
  onSaveNote: () => void;
  onFeedback: (key: string, value: boolean) => void;
}) {
  const { t } = useTranslation("home");
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
      <p dir="auto" className="whitespace-pre-wrap">
        {report.summary}
      </p>
      {technical.length > 0 ? (
        <ReportSection title="Technical feedback">
          <ul className="space-y-2">
            {technical.map((text, index) => (
              <li key={index} className="space-y-1 rounded-xl border p-3">
                <p dir="auto" className="text-sm">
                  {text}
                </p>
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
                <p dir="auto">
                  <span className="text-muted-foreground">Original </span>
                  {item.original}
                </p>
                <p dir="auto">
                  <span className="text-muted-foreground">Try </span>
                  <strong>{item.suggestion}</strong>
                </p>
                <p dir="auto" className="text-muted-foreground">
                  {item.reason}
                </p>
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
                <strong dir="auto">{word.term}</strong>
                <p dir="auto">{word.definition}</p>
                {word.translation ? <p dir="auto">{word.translation}</p> : null}
                {word.example ? (
                  <p dir="auto" className="text-muted-foreground">
                    {word.example}
                  </p>
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
      {report.nextSteps.length > 0 ? (
        <ReportSection title="Next steps">
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {report.nextSteps.map((text, index) => (
              <li key={index} dir="auto">
                {text}
              </li>
            ))}
          </ul>
        </ReportSection>
      ) : null}
      <Button variant="outline" size="sm" onClick={onSaveNote}>
        Save report to Notes
      </Button>
    </div>
  );
}
