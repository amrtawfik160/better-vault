import { z } from "zod";

export const studyAction = z.enum(["chat", "explain", "translate", "cards", "report"]);
export type StudyAction = z.infer<typeof studyAction>;

export const studyAnswerSchema = z.object({
  text: z.string(),
  citations: z.array(z.number()).optional(),
  cards: z.array(z.object({ front: z.string(), back: z.string() })).optional(),
  report: z
    .object({
      summary: z.string(),
      corrections: z.array(z.string()),
      nextSteps: z.array(z.string()),
    })
    .optional(),
});

export const studyPassageSchema = z.object({
  title: z.string().max(500),
  text: z.string().max(12_000),
});
