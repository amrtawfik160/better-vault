import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DirectionalText } from "@/components/common/directional-text";
import type { StudyPractice, StudyPracticeAttempt, StudyPracticeQuestion } from "@/lib/study/records";
import { practiceAttemptVerdict } from "@/lib/study/writing-practice";
import { cn } from "@/lib/utils";
import {
  CitationLinks,
  CopyButton,
  LanguageNotes,
  PointList,
  ScoreMeters,
  Section,
  VerdictBadge,
  VocabularyChips,
} from "./practice-parts";

/** One graded attempt: verdict, what was right, missing or wrong, delivery, a better version, scores and English. */
export function PracticeFeedbackView({
  session,
  question,
  attempt,
  attemptNumber,
  explanation,
  actions,
}: {
  session: StudyPractice;
  question: StudyPracticeQuestion;
  attempt: StudyPracticeAttempt;
  attemptNumber: number;
  /** For a choice question: the AI explanation, or the button that asks for it. */
  explanation?: ReactNode;
  actions: ReactNode;
}) {
  const { t } = useTranslation("home");
  const verdict = practiceAttemptVerdict(question, attempt);
  const feedback = attempt.feedback;
  return (
    <div className="space-y-5" aria-live="polite">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {verdict ? <VerdictBadge verdict={verdict} /> : null}
          {attemptNumber > 1 ? (
            <span className="text-xs text-muted-foreground">{t("study.writingPractice.attemptNumber", { count: attemptNumber })}</span>
          ) : null}
          {attempt.revealed ? (
            <span className="text-xs text-muted-foreground">{t("study.writingPractice.answeredAfterReveal")}</span>
          ) : attempt.hints ? (
            <span className="text-xs text-muted-foreground">{t("study.writingPractice.hintsUsed", { count: attempt.hints })}</span>
          ) : null}
        </div>
        {feedback?.reason ? <DirectionalText text={feedback.reason} className="text-sm" /> : null}
      </div>

      {question.type === "choice" && question.choices ? (
        <ol className="space-y-1.5 text-sm">
          {question.choices.map((choice, index) => {
            const correct = index === question.answer;
            const chosen = index === attempt.choice;
            return (
              <li
                key={index}
                className={cn(
                  "rounded-lg border px-3 py-2",
                  correct && "border-success/50 bg-success/10",
                  chosen && !correct && "border-destructive/50 bg-destructive/10",
                )}
              >
                <DirectionalText as="span" text={choice} />
                {correct ? <span className="ms-2 text-xs text-success">{t("study.writingPractice.correctChoice")}</span> : null}
                {chosen && !correct ? <span className="ms-2 text-xs text-destructive">{t("study.writingPractice.yourChoice")}</span> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {explanation}

      {feedback?.progress ? (
        <div className="rounded-xl bg-info/10 p-3 text-sm">
          <p className="font-medium text-info">{t("study.writingPractice.comparedTitle")}</p>
          <DirectionalText text={feedback.progress} />
        </div>
      ) : null}

      {feedback ? (
        <>
          <div className="grid gap-4 sm:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
            {feedback.right.length ? (
              <Section title={t("study.writingPractice.right")}>
                <PointList session={session} items={feedback.right} marker="bg-success" />
              </Section>
            ) : null}
            {feedback.missing.length ? (
              <Section title={t("study.writingPractice.missing")}>
                <PointList session={session} items={feedback.missing} marker="bg-warning" />
              </Section>
            ) : null}
            {feedback.wrong.length ? (
              <Section title={t("study.writingPractice.wrong")}>
                <PointList session={session} items={feedback.wrong} marker="bg-destructive" />
              </Section>
            ) : null}
          </div>

          {feedback.delivery.length ? (
            <Section title={t(`study.writingPractice.deliveryTitle.${session.audience}`)}>
              <ul className="list-disc space-y-1 ps-5 text-sm">
                {feedback.delivery.map((advice, index) => (
                  <li key={index}>
                    <DirectionalText as="span" text={advice} />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {feedback.better ? (
            <Section title={t("study.writingPractice.better")}>
              <div className="relative rounded-xl border bg-muted/40 p-4 pe-12">
                <DirectionalText multiline text={feedback.better} className="text-sm leading-6 whitespace-pre-wrap" />
                <div className="absolute end-2 top-2">
                  <CopyButton text={feedback.better} />
                </div>
              </div>
            </Section>
          ) : null}

          <Section title={t("study.writingPractice.scoresTitle")}>
            <ScoreMeters scores={feedback.scores} />
          </Section>

          <LanguageNotes items={feedback.language} />
          <VocabularyChips session={session} items={feedback.vocabulary} citations={question.citations} />
        </>
      ) : null}

      {question.type !== "choice" ? (
        <details className="rounded-xl border p-3 text-sm">
          <summary className="cursor-pointer font-medium">{t("study.writingPractice.yourAnswer")}</summary>
          <DirectionalText multiline text={attempt.answer} className="mt-2 whitespace-pre-wrap text-muted-foreground" />
        </details>
      ) : null}
      <details className="rounded-xl border p-3 text-sm">
        <summary className="cursor-pointer font-medium">{t("study.writingPractice.reference")}</summary>
        <div className="mt-2 space-y-2">
          <DirectionalText multiline text={question.reference} className="whitespace-pre-wrap" />
          {question.keyPoints.length ? (
            <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
              {question.keyPoints.map((point, index) => (
                <li key={index}>
                  <DirectionalText as="span" text={point} />
                </li>
              ))}
            </ul>
          ) : null}
          <CitationLinks session={session} citations={question.citations} />
        </div>
      </details>

      <div className="flex flex-wrap gap-2 border-t pt-4">{actions}</div>
    </div>
  );
}
