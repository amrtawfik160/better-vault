import { z } from "zod";
import { visualText } from "@/lib/chat/visual-text";
import {
  studyReportReplySchema,
  studyVisualSchema,
  type StudyCardEdit,
  type StudyCitation,
  type StudyThread,
} from "./records";
import type { StudyDraftPassage } from "./passages";
import { studyCitationOrigin } from "./links";

export const studyAction = z.enum(["chat", "explain", "translate", "cards", "report", "visual"]);
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
  visual: studyVisualSchema.optional(),
});

/** The kinds the Tutor may draw to explain an answer, in the order it should prefer them. */
export const studyExplanationVisuals = [
  "diagram",
  "steps",
  "comparison",
  "timeline",
  "table",
  "chart",
] as const;

/** A thread message as text, with its visual written out (Mermaid, steps, rows…) when it has one. */
export function studyMessageText(message: Pick<StudyThread["messages"][number], "text" | "visual">) {
  if (!message.visual) return message.text;
  return [message.text.trim(), visualText(message.visual.kind, message.visual.data)]
    .filter(Boolean)
    .join("\n\n");
}

export const maxStudyImageBytes = 2 * 1024 * 1024;
export const studyImageSchema = z
  .string()
  .max(Math.ceil(maxStudyImageBytes / 3) * 4 + 32)
  .refine((value) => {
    const encoded = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(
      value,
    )?.[1];
    if (!encoded || encoded.length % 4 !== 0) return false;
    const padding = encoded.endsWith("==") ? 2 : Number(encoded.endsWith("="));
    return (encoded.length / 4) * 3 - padding <= maxStudyImageBytes;
  });

export const studyCardImagesSchema = z.object({
  question: studyImageSchema.optional(),
  answer: studyImageSchema.optional(),
});

export const maxDraftImages = 2;
export const studyDraftImagesSchema = z
  .array(
    z.object({
      passage: z.number().int().min(1).max(8),
      image: studyImageSchema,
    }),
  )
  .max(maxDraftImages)
  .refine((images) => new Set(images.map(({ passage }) => passage)).size === images.length);
export type StudyDraftImages = z.infer<typeof studyDraftImagesSchema>;

export type StudyCardImages = z.infer<typeof studyCardImagesSchema>;

export function studyPracticeImages(card: Pick<StudyCardEdit, "image" | "backImage"> | undefined) {
  return {
    question: card?.image ? studyImageSchema.safeParse(card.image).data : undefined,
    answer: card?.backImage ? studyImageSchema.safeParse(card.backImage).data : undefined,
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
  passages: readonly StudyDraftPassage[],
  textOnly = false,
): StudyCitation[] {
  return [...new Set(citations)]
    .flatMap((index) => {
      if (!Number.isInteger(index) || index < 1) return [];
      const passage = passages[index - 1];
      if (!passage || (textOnly && passage.image && !passage.text.trim())) return [];
      return [{ index, title: passage.title, origin: passage.origin }];
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
    const body = studyMessageText(message).trim();
    if (message.role !== "assistant" || !body) continue;
    const answer = `${labels.tutor}: ${body}`;
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
