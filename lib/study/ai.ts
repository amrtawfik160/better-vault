import { z } from "zod";
import {
  studyReportReplySchema,
  type StudyCardEdit,
  type StudyCitation,
  type StudyThread,
} from "./records";
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
  imageFallback: z.boolean().optional(),
});

const maxCardImageBytes = 2 * 1024 * 1024;
const cardImageSchema = z
  .string()
  .max(Math.ceil(maxCardImageBytes / 3) * 4 + 32)
  .refine((value) => {
    const encoded = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(
      value,
    )?.[1];
    if (!encoded || encoded.length % 4 !== 0) return false;
    const padding = encoded.endsWith("==") ? 2 : Number(encoded.endsWith("="));
    return (encoded.length / 4) * 3 - padding <= maxCardImageBytes;
  });

export const studyCardImagesSchema = z.object({
  question: cardImageSchema.optional(),
  answer: cardImageSchema.optional(),
});

export type StudyCardImages = z.infer<typeof studyCardImagesSchema>;

export function studyPracticeImages(card: Pick<StudyCardEdit, "image" | "backImage"> | undefined) {
  return {
    question: card?.image ? cardImageSchema.safeParse(card.image).data : undefined,
    answer: card?.backImage ? cardImageSchema.safeParse(card.backImage).data : undefined,
  };
}

export const studyPassageSchema = z.object({
  title: z.string().max(500),
  text: z.string().max(12_000),
  previousCitations: z.array(z.number().int().positive()).max(4).optional(),
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
