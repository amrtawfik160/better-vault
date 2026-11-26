import type { StudioOutput } from "@/lib/db/types";
import { updatedFlashcardPractice, type FlashcardAction } from "@/studio/tools/flashcards/practice";
import { updatedQuizAttempt, type QuizAction } from "@/studio/tools/quiz/attempt";

export type StudioPracticeChange =
  | { tool: "quiz"; revision: number; action: QuizAction }
  | { tool: "flashcards"; revision: number; action: FlashcardAction };

export type StudioPracticeUpdate = Pick<StudioOutput, "quizAttempt" | "flashcardPractice">;

export function updatedStudioPractice(
  output: StudioOutput | undefined,
  change: StudioPracticeChange,
): StudioPracticeUpdate | undefined {
  if (change.tool === "quiz") {
    const quizAttempt = updatedQuizAttempt(output, change.revision, change.action);
    return quizAttempt ? { quizAttempt } : undefined;
  }
  const flashcardPractice = updatedFlashcardPractice(output, change.revision, change.action);
  return flashcardPractice ? { flashcardPractice } : undefined;
}
