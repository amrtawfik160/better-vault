import { z } from "zod";
import { studyReportReplySchema, type StudyThread } from "./records";

export const studyAction = z.enum(["chat", "explain", "translate", "cards", "report"]);
export type StudyAction = z.infer<typeof studyAction>;

export const studyAnswerSchema = z.object({
  text: z.string(),
  citations: z.array(z.number()).optional(),
  cards: z.array(z.object({ front: z.string(), back: z.string() })).optional(),
  report: studyReportReplySchema.optional(),
});

export const studyPassageSchema = z.object({
  title: z.string().max(500),
  text: z.string().max(12_000),
});

export const flashcardMaterialLimit = 12_000;

export function studyConversationExcerpt(
  messages: StudyThread["messages"],
  labels: { learner: string; tutor: string },
) {
  const exchanges: string[] = [];
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
    exchanges.push(excerpt);
    remaining -= excerpt.length + 2;
  }
  return exchanges.reverse().join("\n\n");
}
