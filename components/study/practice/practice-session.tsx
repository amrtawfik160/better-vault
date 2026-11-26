import { ArrowLeft01Icon, ArrowRight01Icon, Cards01Icon, RepeatIcon } from "@hugeicons/core-free-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DirectionalText } from "@/components/common/directional-text";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { retryPracticeQuestions, savePracticeAttempt, savePracticeCard, setPracticePosition } from "@/lib/db/writing-practice";
import type { StudyPractice } from "@/lib/study/records";
import {
  latestPracticeAttempt,
  practiceAttemptVerdict,
  practiceFeedbackScore,
  practiceResumePosition,
  practiceSessionStats,
  recurringPracticeAdvice,
  weakPracticeQuestions,
} from "@/lib/study/writing-practice";
import { PracticeQuestion, practiceCardAnswer } from "./practice-question";
import { ProgressBar, ScoreMeter, ScoreMeters, Section, VerdictBadge } from "./practice-parts";

/** A question session: one question at a time, then a summary. */
export function PracticeQuestionsSession({
  session,
  setup,
  open,
}: {
  session: StudyPractice;
  setup?: () => void;
  /** Opens another session (a retry of the weak questions). */
  open: (id: string) => void;
}) {
  const { t } = useTranslation("home");
  const [position, setPosition] = useState(() => practiceResumePosition(session));
  const total = session.questions.length;
  const go = (next: number) => {
    setPosition(next);
    void setPracticePosition(session.id, next).catch(() => undefined);
  };

  if (position >= total) return <PracticeSummary session={session} open={open} back={() => go(Math.max(0, total - 1))} />;
  const question = session.questions[position];
  const answered = session.questions.filter((entry) => latestPracticeAttempt(entry)).length;
  const last = position === total - 1;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium">{t("study.writingPractice.questionOf", { number: position + 1, total })}</span>
          <span className="text-muted-foreground">
            {t(`study.writingPractice.types.${question.type}`)} · {t("study.writingPractice.answeredCount", { count: answered, total })}
          </span>
        </div>
        <ProgressBar value={answered / total} label={t("study.writingPractice.progress")} />
      </div>
      <PracticeQuestion
        key={question.id}
        session={session}
        question={question}
        setup={setup}
        save={(attempt) => savePracticeAttempt(session.id, question.id, attempt)}
        next={
          <Button size="sm" onClick={() => go(position + 1)}>
            {t(last ? "study.writingPractice.seeSummary" : "study.writingPractice.next")}
            <Icon icon={ArrowRight01Icon} size={16} className="rtl:rotate-180" />
          </Button>
        }
      />
      <nav className="flex flex-wrap items-center justify-between gap-2 border-t pt-3" aria-label={t("study.writingPractice.questionNav")}>
        <Button variant="ghost" size="sm" disabled={position === 0} onClick={() => go(position - 1)}>
          <Icon icon={ArrowLeft01Icon} size={16} className="rtl:rotate-180" />
          {t("study.writingPractice.previous")}
        </Button>
        <ol className="flex flex-wrap gap-1">
          {session.questions.map((entry, index) => {
            const verdict = practiceAttemptVerdict(entry, latestPracticeAttempt(entry));
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  aria-current={index === position ? "step" : undefined}
                  aria-label={t("study.writingPractice.goToQuestion", { number: index + 1 })}
                  onClick={() => go(index)}
                  className={
                    "size-8 cursor-pointer rounded-full border text-xs tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 " +
                    (index === position ? "border-ring font-semibold " : "") +
                    (verdict === "correct"
                      ? "bg-success/15 text-success"
                      : verdict === "partial"
                        ? "bg-warning/15 text-warning"
                        : verdict === "incorrect"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-background text-muted-foreground")
                  }
                >
                  {index + 1}
                </button>
              </li>
            );
          })}
        </ol>
        <Button variant="ghost" size="sm" onClick={() => go(total)}>
          {t("study.writingPractice.summary")}
        </Button>
      </nav>
    </div>
  );
}

function PracticeSummary({ session, open, back }: { session: StudyPractice; open: (id: string) => void; back: () => void }) {
  const { t } = useTranslation("home");
  const stats = practiceSessionStats(session);
  const advice = recurringPracticeAdvice(session);
  const weak = weakPracticeQuestions(session);
  const [retrying, setRetrying] = useState(false);
  const [savingCards, setSavingCards] = useState(false);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">{t("study.writingPractice.summaryTitle")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("study.writingPractice.summaryCounts", {
            answered: stats.answered,
            total: stats.total,
            correct: stats.correct,
            partial: stats.partial,
            incorrect: stats.incorrect,
          })}
        </p>
      </div>

      {stats.averages ? (
        <Section title={t("study.writingPractice.averagesTitle")}>
          <ScoreMeters scores={stats.averages} />
        </Section>
      ) : null}

      {advice.length ? (
        <Section title={t("study.writingPractice.adviceTitle")}>
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {advice.map(({ text, count }) => (
              <li key={text}>
                <DirectionalText as="span" text={text} />
                {count > 1 ? (
                  <span className="ms-2 text-xs text-muted-foreground">{t("study.writingPractice.adviceCount", { count })}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title={t("study.writingPractice.perQuestion")}>
        <ol className="divide-y rounded-xl border">
          {session.questions.map((question, index) => {
            const attempt = latestPracticeAttempt(question);
            const verdict = practiceAttemptVerdict(question, attempt);
            const score = practiceFeedbackScore(attempt?.feedback);
            return (
              <li key={question.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className="w-6 text-muted-foreground tabular-nums">{index + 1}</span>
                <DirectionalText as="span" text={question.prompt} className="min-w-0 flex-1 basis-60" />
                {verdict ? <VerdictBadge verdict={verdict} /> : <span className="text-xs text-muted-foreground">{t("study.writingPractice.notAnswered")}</span>}
                {score !== undefined ? (
                  <div className="w-28">
                    <ScoreMeter label={t("study.writingPractice.overall")} value={score} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </Section>

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button variant="ghost" size="sm" onClick={back}>
          <Icon icon={ArrowLeft01Icon} size={16} className="rtl:rotate-180" />
          {t("study.writingPractice.backToQuestions")}
        </Button>
        <span className="flex-1" />
        {weak.length ? (
          <Button
            variant="outline"
            size="sm"
            loading={retrying}
            onClick={async () => {
              setRetrying(true);
              try {
                const retry = await retryPracticeQuestions(
                  session,
                  weak.map(({ id }) => id),
                  t("study.writingPractice.retryTitle", { title: session.title }),
                );
                open(retry.id);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : String(error));
              } finally {
                setRetrying(false);
              }
            }}
          >
            <Icon icon={RepeatIcon} size={16} />
            {t("study.writingPractice.retryWeak", { count: weak.length })}
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          loading={savingCards}
          onClick={async () => {
            setSavingCards(true);
            try {
              for (const question of session.questions) await savePracticeCard(session, question, practiceCardAnswer(question));
              toast.success(t("study.writingPractice.cardsSaved", { count: session.questions.length }));
            } catch (error) {
              toast.error(error instanceof Error ? error.message : String(error));
            } finally {
              setSavingCards(false);
            }
          }}
        >
          <Icon icon={Cards01Icon} size={16} />
          {t("study.writingPractice.saveAllCards")}
        </Button>
      </div>
    </div>
  );
}
