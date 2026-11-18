import { z } from "zod";
import type { StudioOutput } from "@/lib/db/types";
import { quizData, type QuizQuestion } from "./definition";

const attemptSchema = z.object({
  revision: z.number().int().nonnegative(),
  index: z.number().int().nonnegative(),
  answers: z.array(z.number().int().nonnegative()),
});

export type QuizAttempt = z.infer<typeof attemptSchema>;
export type QuizAction =
  { kind: "answer"; option: number } | { kind: "advance" } | { kind: "retry" };

export function readQuizAttempt(questions: readonly QuizQuestion[], saved: unknown): QuizAttempt {
  const parsed = attemptSchema.safeParse(saved);
  if (parsed.success) {
    const { index, answers } = parsed.data;
    if (
      index <= questions.length &&
      (answers.length === index || answers.length === index + 1) &&
      answers.every((answer, at) => answer < (questions[at]?.options.length ?? 0))
    )
      return parsed.data;
  }
  return { revision: parsed.success ? parsed.data.revision : 0, index: 0, answers: [] };
}

export function nextQuizAttempt(
  questions: readonly QuizQuestion[],
  attempt: QuizAttempt,
  action: QuizAction,
): QuizAttempt | undefined {
  const { answers, index, revision } = attempt;
  const current = questions[index];
  switch (action.kind) {
    case "answer":
      if (
        !current ||
        answers.length !== index ||
        !Number.isInteger(action.option) ||
        action.option < 0 ||
        action.option >= current.options.length
      )
        return;
      return { revision: revision + 1, index, answers: [...answers, action.option] };
    case "advance":
      if (!current || answers.length !== index + 1) return;
      return { revision: revision + 1, index: index + 1, answers };
    case "retry":
      return { revision: revision + 1, index: 0, answers: [] };
  }
}

export function updatedQuizAttempt(
  output: StudioOutput | undefined,
  revision: number,
  action: QuizAction,
) {
  if (output?.status !== "ready" || output.toolId !== "quiz") return;
  const data = quizData.safeParse(output.data);
  if (!data.success) return;
  const attempt = readQuizAttempt(data.data.questions, output.quizAttempt);
  if (attempt.revision !== revision) return;
  return nextQuizAttempt(data.data.questions, attempt, action);
}
