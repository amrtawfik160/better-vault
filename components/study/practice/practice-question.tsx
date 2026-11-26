import { BulbIcon, Cards01Icon, Note01Icon, RepeatIcon, ViewIcon } from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DirectionalText } from "@/components/common/directional-text";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { studyId } from "@/lib/db/study";
import { savePracticeCard, savePracticeNote } from "@/lib/db/writing-practice";
import type { StudyPractice, StudyPracticeAttempt, StudyPracticeQuestion } from "@/lib/study/records";
import {
  latestPracticeAttempt,
  practiceQuestionInput,
  practiceRequestPassages,
  previousPracticeAttempt,
} from "@/lib/study/writing-practice";
import { explainPracticeChoice, reviewPracticeAnswer } from "@/lib/study/writing-practice-client";
import {
  clearPracticeAnswerDraft,
  readPracticeAnswerDraft,
  savePracticeAnswerDraft,
} from "@/lib/study/writing-practice-drafts";
import { cn } from "@/lib/utils";
import { PracticeFeedbackView } from "./practice-feedback";
import { AnswerEditor, PracticeError } from "./practice-parts";

/** The answer to save as a flashcard's back: the better version, else the reference. */
export function practiceCardAnswer(question: StudyPracticeQuestion) {
  return latestPracticeAttempt(question)?.feedback?.better || question.reference;
}

/**
 * One question: the writing space (or the choices), hints, "Show me", then
 * the feedback with Try again, Save as flashcard and Save to Notes. The draft
 * is kept in this browser until the answer is graded.
 */
export function PracticeQuestion({
  session,
  question,
  save,
  setup,
  next,
  compact = false,
}: {
  session: StudyPractice;
  question: StudyPracticeQuestion;
  /** Saves an attempt on the session record. */
  save: (attempt: StudyPracticeAttempt) => Promise<unknown>;
  setup?: () => void;
  /** The button after the feedback: Next question, Summary… */
  next?: ReactNode;
  /** A probing question inside a teach-back round: a smaller writing space. */
  compact?: boolean;
}) {
  const { t } = useTranslation("home");
  const graded = latestPracticeAttempt(question);
  const [retrying, setRetrying] = useState(false);
  const [draft, setDraft] = useState(() => readPracticeAnswerDraft(session.id, question.id) ?? { text: "" });
  const [hints, setHints] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [explaining, setExplaining] = useState(false);
  const [savingCard, setSavingCard] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  function changeDraft(next: { text: string; choice?: number }) {
    setDraft(next);
    savePracticeAnswerDraft(session.id, question.id, next);
  }

  const common = () => ({
    audience: session.audience,
    scenario: session.scenario,
    passages: practiceRequestPassages(session),
    question: practiceQuestionInput(question),
  });

  async function submit() {
    if (pending) return;
    const attempt: StudyPracticeAttempt = {
      id: studyId(),
      at: Date.now(),
      answer: draft.text.trim(),
      ...(question.type === "choice" ? { choice: draft.choice } : {}),
      ...(hints ? { hints } : {}),
      ...(revealed ? { revealed: true as const } : {}),
    };
    setError(undefined);
    if (question.type === "choice") {
      if (draft.choice === undefined) return;
      await save(attempt);
    } else {
      if (!attempt.answer) return;
      const controller = new AbortController();
      request.current = controller;
      setPending(true);
      try {
        const feedback = await reviewPracticeAnswer(
          { ...common(), answer: attempt.answer, hints, revealed, previous: previousPracticeAttempt(question) },
          controller.signal,
        );
        await save({ ...attempt, feedback });
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure);
        return;
      } finally {
        setPending(false);
        request.current = null;
      }
    }
    clearPracticeAnswerDraft(session.id, question.id);
    setDraft({ text: "" });
    setHints(0);
    setRevealed(false);
    setRetrying(false);
  }

  async function explain(attempt: StudyPracticeAttempt) {
    if (attempt.choice === undefined) return;
    setExplaining(true);
    setError(undefined);
    try {
      const explanation = await explainPracticeChoice({ ...common(), choice: attempt.choice });
      await save({ ...attempt, explanation });
    } catch (failure) {
      setError(failure);
    } finally {
      setExplaining(false);
    }
  }

  async function saveCard() {
    setSavingCard(true);
    try {
      await savePracticeCard(session, question, practiceCardAnswer(question));
      toast.success(t("study.writingPractice.cardSaved"));
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSavingCard(false);
    }
  }

  async function saveNote(attempt: StudyPracticeAttempt) {
    setSavingNote(true);
    const feedback = attempt.feedback;
    const list = (items: readonly { text: string }[] | readonly string[]) =>
      items.map((item) => `- ${typeof item === "string" ? item : item.text}`).join("\n");
    const body = [
      `## ${t("study.writingPractice.noteQuestion")}\n\n${question.prompt}`,
      attempt.answer ? `## ${t("study.writingPractice.yourAnswer")}\n\n${attempt.answer}` : "",
      feedback?.better ? `## ${t("study.writingPractice.better")}\n\n${feedback.better}` : "",
      feedback?.missing.length ? `## ${t("study.writingPractice.missing")}\n\n${list(feedback.missing)}` : "",
      feedback?.wrong.length ? `## ${t("study.writingPractice.wrong")}\n\n${list(feedback.wrong)}` : "",
      feedback?.delivery.length ? `## ${t(`study.writingPractice.deliveryTitle.${session.audience}`)}\n\n${list(feedback.delivery)}` : "",
      `## ${t("study.writingPractice.reference")}\n\n${question.reference}`,
    ].filter(Boolean).join("\n\n");
    try {
      await savePracticeNote(session, { title: `${session.title} · ${question.prompt}`, body, citations: question.citations });
      toast.success(t("study.writingPractice.noteSaved"));
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSavingNote(false);
    }
  }

  const prompt = (
    <div className="space-y-1">
      <DirectionalText multiline text={question.prompt} className={cn("font-medium whitespace-pre-wrap", compact ? "text-base" : "text-lg leading-7")} />
      {question.type === "write" && question.targetWords ? (
        <p className="text-xs text-muted-foreground">{t("study.writingPractice.target", { count: question.targetWords })}</p>
      ) : null}
    </div>
  );

  if (graded && !retrying) {
    return (
      <div className="space-y-4">
        {prompt}
        <PracticeFeedbackView
          session={session}
          question={question}
          attempt={graded}
          attemptNumber={question.attempts.indexOf(graded) + 1}
          explanation={
            question.type === "choice" ? (
              graded.explanation ? (
                <DirectionalText text={graded.explanation} className="rounded-xl bg-muted/50 p-3 text-sm" />
              ) : (
                <Button variant="ghost" size="sm" loading={explaining} onClick={() => void explain(graded)}>
                  {t("study.writingPractice.explainChoice")}
                </Button>
              )
            ) : undefined
          }
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (question.type !== "choice" && !draft.text.trim()) changeDraft({ text: graded.answer });
                  setRetrying(true);
                }}
              >
                <Icon icon={RepeatIcon} size={16} />
                {t("study.writingPractice.tryAgain")}
              </Button>
              <Button variant="outline" size="sm" loading={savingCard} onClick={() => void saveCard()}>
                <Icon icon={Cards01Icon} size={16} />
                {t("study.writingPractice.saveCard")}
              </Button>
              <Button variant="outline" size="sm" loading={savingNote} onClick={() => void saveNote(graded)}>
                <Icon icon={Note01Icon} size={16} />
                {t("study.writingPractice.saveNote")}
              </Button>
              <span className="flex-1" />
              {next}
            </>
          }
        />
        {error ? <PracticeError error={error} setup={setup} /> : null}
      </div>
    );
  }

  const hintPoints = question.keyPoints.slice(0, hints);
  const helpers = (
    <>
      {hints < question.keyPoints.length && !revealed ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setHints(hints + 1)}>
          <Icon icon={BulbIcon} size={16} />
          {t("study.writingPractice.hint")}
        </Button>
      ) : null}
      {!revealed ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setRevealed(true)}>
          <Icon icon={ViewIcon} size={16} />
          {t("study.writingPractice.showMe")}
        </Button>
      ) : null}
      {retrying ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setRetrying(false)}>
          {t("study.writingPractice.cancel")}
        </Button>
      ) : null}
    </>
  );

  return (
    <div className="space-y-4">
      {prompt}
      {hintPoints.length || revealed ? (
        <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-sm">
          {revealed ? (
            <>
              <p className="font-medium">{t("study.writingPractice.reference")}</p>
              <DirectionalText multiline text={question.reference} className="whitespace-pre-wrap" />
              <p className="text-xs text-muted-foreground">{t("study.writingPractice.revealedNote")}</p>
            </>
          ) : (
            <>
              <p className="font-medium">{t("study.writingPractice.hintsTitle")}</p>
              <ul className="list-disc space-y-1 ps-5">
                {hintPoints.map((point, index) => (
                  <li key={index}>
                    <DirectionalText as="span" text={point} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
      {question.type === "choice" ? (
        <fieldset className="space-y-2">
          <legend className="sr-only">{t("study.writingPractice.chooseAnswer")}</legend>
          {(question.choices ?? []).map((choice, index) => (
            <label
              key={index}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors hover:bg-muted/50",
                draft.choice === index && "border-ring bg-muted/50",
              )}
            >
              <input
                type="radio"
                name={`choice-${question.id}`}
                className="mt-0.5 accent-primary"
                checked={draft.choice === index}
                onChange={() => changeDraft({ text: "", choice: index })}
              />
              <DirectionalText as="span" text={choice} />
            </label>
          ))}
          <div className="flex flex-wrap justify-end gap-2">
            {retrying ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setRetrying(false)}>
                {t("study.writingPractice.cancel")}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant={compact ? "secondary" : "default"}
              className={compact ? "border border-input" : undefined}
              disabled={draft.choice === undefined}
              onClick={() => void submit()}
            >
              {t("study.writingPractice.check")}
            </Button>
          </div>
        </fieldset>
      ) : (
        <AnswerEditor
          label={t("study.writingPractice.answerLabel")}
          value={draft.text}
          onChange={(text) => changeDraft({ text })}
          onSubmit={() => void submit()}
          placeholder={t(question.type === "recall" ? "study.writingPractice.recallPlaceholder" : "study.writingPractice.writePlaceholder")}
          targetWords={question.type === "write" ? question.targetWords : undefined}
          minRows={compact || question.type === "recall" ? 3 : 8}
          disabled={pending}
          secondary={compact}
        >
          {helpers}
        </AnswerEditor>
      )}
      {pending ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t("study.writingPractice.reviewing")}
        </p>
      ) : null}
      {error ? <PracticeError error={error} retry={() => void submit()} setup={setup} /> : null}
    </div>
  );
}
