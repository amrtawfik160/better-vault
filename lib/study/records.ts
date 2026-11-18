import { z } from "zod";

const base = z.object({ id: z.string(), notebookId: z.string().optional(), updatedAt: z.number() });
const section = z.object({ title: z.string(), text: z.string(), epubPath: z.string().optional() });
const schedule = z.object({
  dueAt: z.number(),
  intervalDays: z.number(),
  repetitions: z.number(),
  ease: z.number(),
  state: z.enum(["new", "learning", "reviewing", "mature"]).optional(),
  step: z.union([z.literal(0), z.literal(1)]).optional(),
  lapses: z.number().int().nonnegative().optional(),
});
const index = z.number().int().nonnegative();
export const studyOriginSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("book"),
    bookId: z.string(),
    section: index.optional(),
    highlightId: z.string().optional(),
    offset: index.optional(),
    length: index.optional(),
  }),
  z.object({ kind: z.literal("note"), noteId: z.string() }),
  z.object({ kind: z.literal("tutor"), threadId: z.string(), message: index.optional() }),
  z.object({ kind: z.literal("report"), threadId: z.string() }),
  z.object({ kind: z.literal("studio"), notebookId: z.string(), outputId: z.string() }),
  z.object({ kind: z.literal("word"), wordId: z.string() }),
]);

const citationFields = { index: z.number().int().positive(), title: z.string() };
const citation = z.union([
  z.object({ ...citationFields, origin: studyOriginSchema }),
  z.object({ ...citationFields, bookId: z.string(), section: index }),
]);

export const studyGoals = ["book", "teach-back", "language", "general"] as const;
export const studyScopes = ["passage", "chapter", "book", "notes", "general"] as const;
export const studyCorrections = ["live", "report", "off"] as const;
export const studyRatings = ["again", "hard", "good", "easy"] as const;

const reportTechnicalFeedback = z.object({ text: z.string() });
const reportLanguageFeedback = z.object({
  original: z.string(),
  suggestion: z.string(),
  reason: z.string(),
});
const reportVocabulary = z.object({
  term: z.string(),
  definition: z.string(),
  translation: z.string(),
  example: z.string(),
  language: z.string(),
});
export const studyReportReplySchema = z.object({
  summary: z.string(),
  corrections: z.array(z.string()),
  nextSteps: z.array(z.string()),
  technicalFeedback: z.array(reportTechnicalFeedback).optional(),
  languageFeedback: z.array(reportLanguageFeedback).optional(),
  vocabulary: z.array(reportVocabulary).optional(),
});
const feedback = z.record(z.string(), z.boolean());
const studyReportSchema = studyReportReplySchema.extend({
  helpful: z.boolean().optional(),
  feedback: feedback.optional(),
  generatedAt: z.number().optional(),
  languageStatus: z.enum(["not-requested", "insufficient", "reviewed"]).optional(),
});

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
    bookmarks: z.array(index),
    bookmarkPlaces: z
      .array(
        z.object({
          id: z.string(),
          section: index,
          offset: index,
          quote: z.string(),
        }),
      )
      .optional(),
    attachedToNotebook: z.literal(true).optional(),
    lastReadAt: z.number().optional(),
  }),
  base.extend({
    kind: z.literal("card"),
    front: z.string(),
    back: z.string(),
    image: z.string().optional(),
    backImage: z.string().optional(),
    origin: studyOriginSchema.optional(),
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
    origin: studyOriginSchema.optional(),
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
    origin: studyOriginSchema.optional(),
  }),
  base.extend({
    kind: z.literal("thread"),
    title: z.string(),
    goal: z.enum(studyGoals),
    scope: z.enum(studyScopes),
    corrections: z.enum(studyCorrections).optional(),
    practiceLanguage: z.string().max(35).optional(),
    keepVoiceTranscripts: z.boolean().optional(),
    bookId: z.string().optional(),
    section: z.number().int().nonnegative().optional(),
    quote: z.string().optional(),
    offset: index.optional(),
    noteIds: z.array(z.string()).optional(),
    vaultId: z.string().optional(),
    messages: z.array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string(),
        citations: z.array(citation).optional(),
        at: z.number().optional(),
      }),
    ),
    report: studyReportSchema.optional(),
  }),
]);

export type StudyReport = z.infer<typeof studyReportSchema>;
export type StudyOrigin = z.infer<typeof studyOriginSchema>;
export type StudyCitation = z.infer<typeof citation>;
export type StudyRecord = z.infer<typeof studyRecordSchema>;
export type StudyRecordOf<K extends StudyRecord["kind"]> = Extract<StudyRecord, { kind: K }>;
export type StudyBook = StudyRecordOf<"book">;
export type StudyThread = StudyRecordOf<"thread">;
export type StudySchedule = z.infer<typeof schedule>;
export type StudySection = z.infer<typeof section>;
export type StudyReviewWrite = {
  id: string;
  previousDueAt: number;
  schedule: StudySchedule;
  activity: StudyRecordOf<"session">;
};
export type StudyRating = (typeof studyRatings)[number];
