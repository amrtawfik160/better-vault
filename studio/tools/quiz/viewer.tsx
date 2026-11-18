import {
  BulbIcon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  RotateLeft01Icon,
} from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DirectionalText, directionalInline } from "@/components/common/directional-text";
import { textDirection } from "@/lib/text/direction";
import { Button } from "@/components/panelui/button";
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
  const heading = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (answered ? feedback.current : heading.current)?.focus({ preventScroll: true });
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
        <h3
          ref={heading}
          tabIndex={-1}
          className="text-4xl font-semibold tabular-nums outline-none"
        >
          {score}/{total}
        </h3>
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

      <h3
        ref={heading}
        tabIndex={-1}
        dir={direction}
        className="text-xl leading-snug font-semibold outline-none"
      >
        {directionalInline(question.question, direction)}
      </h3>

      <div role="radiogroup" aria-label={question.question} className="flex flex-col gap-2">
        {question.options.map((option, at) => {
          const right = at === question.answer;
          const picked = at === chosen;
          return (
            <button
              key={at}
              type="button"
              role="radio"
              aria-checked={picked}
              disabled={answered || committing}
              onClick={() => void apply({ kind: "answer", option: at })}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 text-start transition-colors outline-none",
                "hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent",
                answered && right && "border-success bg-success/10 disabled:hover:bg-success/10",
                answered &&
                  picked &&
                  !right &&
                  "border-destructive bg-destructive/10 disabled:hover:bg-destructive/10",
              )}
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                {LETTERS[at]}
              </span>
              <DirectionalText
                as="span"
                text={option}
                className="min-w-0 flex-1 pt-0.5 text-[0.9375rem] leading-6"
              />
              {answered && right ? (
                <Icon icon={CheckmarkCircle02Icon} size={18} className="mt-0.5 text-success" />
              ) : null}
              {answered && picked && !right ? (
                <Icon icon={CancelCircleIcon} size={18} className="mt-0.5 text-destructive" />
              ) : null}
            </button>
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
          <DirectionalText multiline className="mt-1" text={question.explanation} />
          <StudioStudySources sources={question.sources} open={onOpenPassage} />
        </div>
      ) : question.hint ? (
        hintRevision === attempt.revision ? (
          <p className="flex items-start gap-2 rounded-2xl bg-warning/10 px-4 py-3 text-sm leading-6">
            <Icon icon={BulbIcon} size={16} className="mt-1 shrink-0 text-warning" />
            <DirectionalText as="span" multiline className="min-w-0 flex-1" text={question.hint} />
          </p>
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
