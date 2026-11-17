import { z } from "zod";

const base = z.object({ id: z.string(), notebookId: z.string().optional(), updatedAt: z.number() });
const section = z.object({ title: z.string(), text: z.string() });
const schedule = z.object({
  dueAt: z.number(),
  intervalDays: z.number(),
  repetitions: z.number(),
  ease: z.number(),
});
const citation = z.object({
  index: z.number(),
  bookId: z.string(),
  section: z.number(),
  title: z.string(),
});
export const studyGoals = ["book", "teach-back", "language", "general"] as const;
export const studyScopes = ["passage", "chapter", "book", "notes", "general"] as const;
export const studyCorrections = ["live", "report", "off"] as const;
export const studyRatings = ["again", "hard", "good", "easy"] as const;

export const studyRecordSchema = z.discriminatedUnion("kind", [
  base.extend({
    kind: z.literal("book"),
    notebookId: z.string(),
    sourceId: z.string(),
    title: z.string(),
    format: z.enum(["pdf", "epub", "text"]),
    fileId: z.string().optional(),
    sections: z.array(section).min(1),
    section: z.number().int().nonnegative(),
    bookmarks: z.array(z.number().int().nonnegative()),
  }),
  base.extend({
    kind: z.literal("card"),
    front: z.string(),
    back: z.string(),
    image: z.string().optional(),
    tags: z.array(z.string()),
    schedule,
  }),
  base.extend({
    kind: z.literal("highlight"),
    bookId: z.string(),
    section: z.number().int().nonnegative(),
    quote: z.string(),
    offset: z.number().int().nonnegative(),
    color: z.enum(["yellow", "green", "blue", "pink"]),
    note: z.string(),
    schedule,
  }),
  base.extend({
    kind: z.literal("word"),
    term: z.string(),
    translation: z.string(),
    context: z.string(),
    language: z.string(),
    note: z.string(),
    bookId: z.string().optional(),
  }),
  base.extend({
    kind: z.literal("session"),
    activity: z.enum(["reading", "review", "speaking"]),
    seconds: z.number().nonnegative(),
    count: z.number().int().nonnegative(),
    rating: z.enum(studyRatings).optional(),
    itemId: z.string().optional(),
  }),
  base.extend({
    kind: z.literal("thread"),
    title: z.string(),
    goal: z.enum(studyGoals),
    scope: z.enum(studyScopes),
    corrections: z.enum(studyCorrections).optional(),
    bookId: z.string().optional(),
    section: z.number().int().nonnegative().optional(),
    quote: z.string().optional(),
    noteIds: z.array(z.string()).optional(),
    messages: z.array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string(),
        citations: z.array(citation).optional(),
      }),
    ),
    report: z
      .object({
        summary: z.string(),
        corrections: z.array(z.string()),
        nextSteps: z.array(z.string()),
        helpful: z.boolean().optional(),
      })
      .optional(),
  }),
]);

export type StudyRecord = z.infer<typeof studyRecordSchema>;
export type StudyRecordOf<K extends StudyRecord["kind"]> = Extract<StudyRecord, { kind: K }>;
export type StudyBook = StudyRecordOf<"book">;
export type StudyThread = StudyRecordOf<"thread">;
export type StudySchedule = z.infer<typeof schedule>;
export type StudySection = z.infer<typeof section>;
export type StudyRating = (typeof studyRatings)[number];
