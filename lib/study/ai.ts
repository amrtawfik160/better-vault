import { z } from "zod";
import { studyReportReplySchema, type StudyCitation, type StudyThread } from "./records";
import type { StudyPassage } from "./passages";
import { studyCitationOrigin } from "./links";

export const studyAction = z.enum(["chat", "explain", "translate", "cards", "report"]);
export type StudyAction = z.infer<typeof studyAction>;

export const studyCardDraftSchema = z.object({
  front: z.string(),
  back: z.string(),
  citations: z.array(z.number()).optional(),
});

export const studyAnswerSchema = z.object({
  text: z.string(),
  citations: z.array(z.number()).optional(),
  cards: z.array(studyCardDraftSchema).optional(),
  report: studyReportReplySchema.optional(),
});

export const studyPassageSchema = z.object({
  title: z.string().max(500),
  text: z.string().max(12_000),
});

export const flashcardMaterialLimit = 12_000;
export const flashcardPassageSize = flashcardMaterialLimit / 8;

export function flashcardCitationsFor(
  citations: readonly number[] | undefined,
  passages: readonly StudyPassage[],
): StudyCitation[] {
  return [...new Set(citations)]
    .flatMap((index) => {
      if (!Number.isInteger(index) || index < 1) return [];
      const passage = passages[index - 1];
      return passage ? [{ index, title: passage.title, origin: passage.origin }] : [];
    })
    .slice(0, 3);
}

export function studyConversationMaterial(
  messages: StudyThread["messages"],
  labels: { learner: string; tutor: string },
) {
  const exchanges: { text: string; citations: StudyCitation[] }[] = [];
  let remaining = flashcardMaterialLimit;
  for (let index = messages.length - 1; index >= 0 && remaining > 0; index--) {
    const message = messages[index];
    if (message.role !== "assistant" || !message.text.trim()) continue;
    const answer = `${labels.tutor}: ${message.text.trim()}`;
    if (exchanges.length && answer.length > remaining) break;
    const preceding = messages[index - 1];
    const question = preceding?.role === "user" ? preceding.text.trim() : "";
    const exchange = question ? `${labels.learner}: ${question}\n\n${answer}` : answer;
    const excerpt = exchange.length <= remaining ? exchange : answer.slice(0, remaining);
    exchanges.push({
      text: excerpt,
      citations: excerpt.length >= answer.length ? (message.citations ?? []) : [],
    });
    remaining -= excerpt.length + 2;
  }
  return {
    text: exchanges
      .toReversed()
      .map(({ text }) => text)
      .join("\n\n"),
    evidence: exchanges.flatMap(({ citations }) => citations.map(studyCitationOrigin)),
  };
}
