import type { QuizQuestion } from "@/studio/tools/quiz/definition";
import type { StudyRecordOf } from "./records";

export function quizCardContent(question: QuizQuestion | undefined) {
  const front = question?.question.trim();
  const answer = question?.options[question.answer]?.trim();
  if (!question || !front || !answer) return;
  return {
    front,
    back: [answer, question.explanation.trim()].filter(Boolean).join("\n\n"),
    quizChoices: question.options.map((choice) => choice.trim()),
  };
}

export function legacyQuizCardSource(card: StudyRecordOf<"card">) {
  if (card.quizChoices !== undefined || card.origin?.kind !== "studio") return;
  const { notebookId, outputId } = card.origin;
  const prefix = `quiz-${outputId}-`;
  if (!card.id.startsWith(prefix)) return;
  const suffix = card.id.slice(prefix.length);
  if (!/^\d+$/.test(suffix)) return;
  return { notebookId, outputId, position: Number(suffix) };
}

export function quizChoicesText(choices: readonly string[], limit = Infinity) {
  const parts = choices.map((choice, index) => ({
    marker: `${index < 26 ? String.fromCharCode(65 + index) : index + 1}. `,
    choice,
  }));
  const full = parts.map(({ marker, choice }) => marker + choice).join("\n");
  if (full.length <= limit) return full;

  const lineBudget = Math.floor((limit + 1) / choices.length) - 1;
  return parts
    .map(({ marker, choice }) => marker + choice.slice(0, Math.max(0, lineBudget - marker.length)))
    .join("\n")
    .slice(0, limit);
}
