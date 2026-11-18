import {
  BulbIcon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  RotateLeft01Icon,
} from "@hugeicons/core-free-icons";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { textDirection } from "@/lib/text/direction";
import { Button } from "@/components/panelui/button";
import { StudyText } from "@/components/study/study-text";
import { cn } from "@/lib/utils";
import type { ToolViewerProps } from "@/studio/shared/form";
import { StudioStudySources } from "@/studio/shared/study-sources";
import { nextQuizAttempt, readQuizAttempt, type QuizAction, type QuizAttempt } from "./attempt";
import type { QuizData } from "./definition";

const LETTERS = "ABCDEFGH";

/** One question at a time: pick an answer, see why, and get a score at the end. */
export function QuizViewer({
  data,
  quizAttempt,
  onQuizAction,
  onReviewMissed,
  onOpenPassage,
}: ToolViewerProps<QuizData>) {
  const { t } = useTranslation("studio");
  const total = data.questions.length;
  const saved = readQuizAttempt(data.questions, quizAttempt);
  const [localAttempt, setLocalAttempt] = useState<QuizAttempt>();
  const attempt = localAttempt && localAttempt.revision > saved.revision ? localAttempt : saved;
  const { index, answers } = attempt;
  const [hintRevision, showHint] = useState<number>();
  const [committing, setCommitting] = useState(false);
  const [restart, setRestart] = useState(false);
  const [saving, setSaving] = useState(false);
  const finished = index >= total;
  const chosen = answers[index];
  const answered = chosen !== undefined;
  const questionId = useId();
  const heading = useRef<HTMLDivElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (answered ? feedback.current : heading.current)?.focus();
  }, [localAttempt, answered]);

  async function apply(action: QuizAction) {
    if (committing) return;
    setCommitting(true);
    try {
      const next = onQuizAction
        ? await onQuizAction(attempt.revision, action)
        : nextQuizAttempt(data.questions, attempt, action);
      if (!next) {
        toast.info(t("quiz.viewer.attemptChanged"));
        return;
      }
      moveFocus.current = true;
      setLocalAttempt(next);
    } catch {
      toast.error(t("quiz.viewer.saveAttemptFailed"));
    } finally {
      setCommitting(false);
    }
  }

  if (finished) {
    const missed = answers.flatMap((answer, at) =>
      answer === data.questions[at].answer ? [] : [at],
    );
    const score = total - missed.length;
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-16 text-center">
        <div
          ref={heading}
          role="heading"
          aria-level={3}
          tabIndex={-1}
          className="text-4xl font-semibold tabular-nums outline-none"
        >
          {score}/{total}
        </div>
        <p className="text-muted-foreground">{t("quiz.viewer.score", { score, total })}</p>
        {onReviewMissed && missed.length ? (
          <Button
            shape="pill"
            loading={saving}
            disabled={committing}
            onClick={async () => {
              if (saving) return;
              setSaving(true);
              try {
                await onReviewMissed(missed);
              } finally {
                setSaving(false);
              }
            }}
          >
            {t("quiz.viewer.reviewMissed", { count: missed.length })}
          </Button>
        ) : null}
        <Button
          shape="pill"
          variant={onReviewMissed && missed.length ? "outline" : "default"}
          loading={committing}
          disabled={saving}
          onClick={() => void apply({ kind: "retry" })}
        >
          <Icon icon={RotateLeft01Icon} size={16} />
          {t("quiz.viewer.retry")}
        </Button>
      </div>
    );
  }

  const question = data.questions[index];
  const direction = textDirection(question.question);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 pb-10">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground tabular-nums">
            {t("quiz.viewer.progress", { current: index + 1, total })}
          </p>
          {answers.length ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={committing}
              onClick={() => setRestart(true)}
            >
              {t("quiz.viewer.restart")}
            </Button>
          ) : null}
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-chart-3 transition-[width]"
            style={{ width: `${(index / total) * 100}%` }}
          />
        </div>
      </div>

      <div
        ref={heading}
        id={questionId}
        role="heading"
        aria-level={3}
        tabIndex={-1}
        dir={direction}
        className="min-w-0 outline-none"
      >
        <StudyText text={question.question} className="text-xl leading-snug font-semibold" />
      </div>

      <div role="radiogroup" aria-labelledby={questionId} className="flex flex-col gap-2">
        {question.options.map((option, at) => {
          const right = at === question.answer;
          const picked = at === chosen;
          const optionId = `${questionId}-option-${at}`;
          return (
            <div
              key={at}
              className={cn(
                "relative flex min-w-0 items-start gap-3 rounded-2xl border px-4 py-3 text-start transition-colors",
                "has-[:enabled]:hover:bg-muted/60",
                answered && right && "border-success bg-success/10",
                answered && picked && !right && "border-destructive bg-destructive/10",
              )}
            >
              <button
                type="button"
                role="radio"
                aria-checked={picked}
                aria-labelledby={`${optionId}-letter ${optionId}`}
                disabled={answered || committing}
                onClick={() => void apply({ kind: "answer", option: at })}
                className="absolute inset-0 cursor-pointer rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
              />
              <span
                id={`${optionId}-letter`}
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
              >
                {LETTERS[at]}
              </span>
              <div id={optionId} className="min-w-0 flex-1 pt-0.5">
                <StudyText
                  text={option}
                  className="text-[0.9375rem] leading-6 [overflow-wrap:anywhere] [&_.katex-display]:relative [&_pre]:relative"
                />
              </div>
              {answered && right ? (
                <Icon icon={CheckmarkCircle02Icon} size={18} className="mt-0.5 text-success" />
              ) : null}
              {answered && picked && !right ? (
                <Icon icon={CancelCircleIcon} size={18} className="mt-0.5 text-destructive" />
              ) : null}
            </div>
          );
        })}
      </div>

      {answered ? (
        <div
          ref={feedback}
          tabIndex={-1}
          className="rounded-2xl bg-muted/60 px-4 py-3 text-sm leading-6 outline-none"
        >
          <p
            className={cn(
              "font-semibold",
              chosen === question.answer ? "text-success" : "text-destructive",
            )}
          >
            {chosen === question.answer ? t("quiz.viewer.correct") : t("quiz.viewer.incorrect")}
          </p>
          <StudyText className="mt-1 text-sm leading-6" text={question.explanation} />
          <StudioStudySources sources={question.sources} open={onOpenPassage} />
        </div>
      ) : question.hint ? (
        hintRevision === attempt.revision ? (
          <div className="flex items-start gap-2 rounded-2xl bg-warning/10 px-4 py-3 text-sm leading-6">
            <Icon icon={BulbIcon} size={16} className="mt-1 shrink-0 text-warning" />
            <StudyText className="min-w-0 flex-1 text-sm leading-6" text={question.hint} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => showHint(attempt.revision)}
            className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <Icon icon={BulbIcon} size={16} />
            {t("quiz.viewer.showHint")}
          </button>
        )
      ) : null}

      <div className="flex justify-end">
        <Button
          shape="pill"
          disabled={!answered}
          loading={committing && answered}
          onClick={() => void apply({ kind: "advance" })}
        >
          {index + 1 === total ? t("quiz.viewer.finish") : t("quiz.viewer.next")}
        </Button>
      </div>
      <ConfirmDialog
        open={restart}
        onOpenChange={setRestart}
        title={t("quiz.viewer.restartTitle")}
        body={t("quiz.viewer.restartBody")}
        confirmLabel={t("quiz.viewer.restart")}
        onConfirm={() => apply({ kind: "retry" })}
      />
    </div>
  );
}
