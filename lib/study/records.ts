import { z } from "zod";
import { notePassageSchema } from "@/lib/notes/search-match";

const base = z.object({
  id: z.string(),
  notebookId: z.string().optional(),
  vaultId: z.string().optional(),
  updatedAt: z.number(),
});
const section = z.object({
  title: z.string(),
  text: z.string(),
  epubPath: z.string().optional(),
  markdown: z.string().optional(),
});
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
const readingSurface = z.enum(["text", "layout"]);
export const studyEpubTheme = z.enum(["system", "light", "sepia", "dark"]);
const readingAppearance = z.object({
  textSize: z.number().int().min(14).max(28).optional(),
  pdfZoom: z.number().int().min(75).max(200).multipleOf(25).optional(),
  epubTheme: studyEpubTheme.optional(),
});
export type StudyReadingAppearance = Required<z.infer<typeof readingAppearance>>;
export const defaultStudyReadingAppearance: StudyReadingAppearance = {
  textSize: 18,
  pdfZoom: 100,
  epubTheme: "system",
};
const readingPlace = z.object({
  section: index,
  surface: readingSurface,
  progress: z.number().min(0).max(1),
  endRevision: index.optional(),
  anchor: z.object({ offset: index, quote: z.string().min(1).max(96), revision: index }).optional(),
});
const textEdit = z.object({
  section: index,
  ranges: z.array(z.object({ before: index, after: index, length: z.number().int().positive() })),
});
const studyVisualOrigin = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pdf"), top: index.max(10_000) }),
  z.object({ kind: z.literal("epub"), figure: index }),
]);
export const studyOriginSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("book"),
    bookId: z.string(),
    section: index.optional(),
    highlightId: z.string().optional(),
    offset: index.optional(),
    length: index.optional(),
    revision: index.optional(),
    visual: studyVisualOrigin.optional(),
  }),
  z.object({
    kind: z.literal("note"),
    noteId: z.string(),
    heading: z.string().optional(),
    passage: notePassageSchema.optional(),
  }),
  z.object({
    kind: z.literal("source"),
    notebookId: z.string(),
    sourceId: z.string(),
    chunkId: z.string(),
    snippet: z.string().max(280).optional(),
  }),
  z.object({ kind: z.literal("tutor"), threadId: z.string(), message: index.optional() }),
  z.object({
    kind: z.literal("notebook-answer"),
    notebookId: z.string(),
    conversationId: z.string(),
    messageId: z.string(),
  }),
  z.object({
    kind: z.literal("report"),
    threadId: z.string(),
    reportId: z.string().optional(),
    suggestion: z.string().regex(/^(language|word)-\d+$/u).optional(),
  }),
  z.object({ kind: z.literal("studio"), notebookId: z.string(), outputId: z.string() }),
  z.object({ kind: z.literal("card"), cardId: z.string() }),
  z.object({ kind: z.literal("word"), wordId: z.string() }),
]);

const citationFields = { index: z.number().int().positive(), title: z.string() };
const citation = z.union([
  z.object({ ...citationFields, origin: studyOriginSchema }),
  z.object({ ...citationFields, bookId: z.string(), section: index }),
]);
export { citation as studyCitationSchema };

export const studyGoal = z.enum([
  "book",
  "teach-back",
  "technical-interview",
  "meeting-simulation",
  "language",
  "general",
]);
export const studyScopes = ["passage", "chapter", "book", "notes", "materials", "cards", "image", "general"] as const;
export const studyCorrections = ["live", "report", "off"] as const;
export const studyRatings = ["again", "hard", "good", "easy"] as const;
export const studyHighlightColor = z.enum(["yellow", "green", "blue", "pink", "purple"]);

const documentDraftBody = z.object({ text: z.string(), markdown: z.boolean() });
const documentDraftSnapshot = z.discriminatedUnion("kind", [
  documentDraftBody.extend({ kind: z.literal("new"), title: z.string() }),
  documentDraftBody.extend({ kind: z.literal("edit"), original: z.string(), originalMarkdown: z.string().optional() }),
]);
export const studyDocumentDraftSchema = base.extend({
  kind: z.literal("document-draft"),
  bookId: z.string().optional(),
  version: z.string(),
  snapshot: documentDraftSnapshot.nullable(),
});

export const studyTutorContextSchema = z.object({
  goal: studyGoal,
  scope: z.enum(studyScopes),
  corrections: z.enum(studyCorrections).optional(),
  practiceLanguage: z.string().max(35).optional(),
  bookId: z.string().optional(),
  section: index.optional(),
  quote: z.string().optional(),
  offset: index.optional(),
  revision: index.optional(),
  noteIds: z.array(z.string()).optional(),
  bookIds: z.array(z.string()).optional(),
  sourceIds: z.array(z.string()).optional(),
  highlightIds: z.array(z.string()).optional(),
  cardIds: z.array(z.string()).optional(),
  practiceCardId: z.string().optional(),
  imageContext: z.object({ anchor: studyVisualOrigin, description: z.string().max(500).optional() }).optional(),
});

const followUpSchema = z.object({
  threadId: z.string(),
  reportId: z.string(),
  index,
  text: z.string(),
});

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
export const studyTutorDraftSchema = z.object({
  id: z.string(),
  text: z.string().max(12_000),
  at: z.number(),
  speech: z.enum(["dictated", "spoken"]).optional(),
});
const studyReportSchema = studyReportReplySchema.extend({
  id: z.string().optional(),
  helpful: z.boolean().optional(),
  feedback: feedback.optional(),
  generatedAt: z.number().optional(),
  practiceContext: studyTutorContextSchema.optional(),
  plannedSteps: z
    .record(z.string(), z.object({ savedAt: z.number(), completedAt: z.number().optional() }))
    .optional(),
  languageStatus: z.enum(["not-requested", "insufficient", "reviewed"]).optional(),
});

export const studyRecordSchema = z.discriminatedUnion("kind", [
  studyDocumentDraftSchema,
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
    textEdits: z.array(textEdit).optional(),
    bookmarkPlaces: z
      .array(
        z.object({
          id: z.string(),
          section: index,
          offset: index,
          quote: z.string(),
          revision: index.optional(),
        }),
      )
      .optional(),
    attachedToNotebook: z.literal(true).optional(),
    lastReadAt: z.number().optional(),
    preferredReadingSurface: readingSurface.optional(),
    readingAppearance: readingAppearance.optional(),
    readingPlace: readingPlace.optional(),
  }),
  base.extend({
    kind: z.literal("card"),
    front: z.string(),
    back: z.string(),
    quizChoices: z.array(z.string()).optional(),
    image: z.string().optional(),
    backImage: z.string().optional(),
    origin: studyOriginSchema.optional(),
    citations: z.array(citation).optional(),
    tags: z.array(z.string()),
    schedule,
  }),
  base.extend({
    kind: z.literal("highlight"),
    bookId: z.string(),
    section: z.number().int().nonnegative(),
    quote: z.string(),
    offset: z.number().int().nonnegative(),
    revision: index.optional(),
    color: studyHighlightColor,
    note: z.string(),
    cue: z.string().optional(),
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
    examples: z.array(z.object({ context: z.string(), origin: studyOriginSchema.optional() })).optional(),
  }),
  base.extend({
    kind: z.literal("session"),
    activity: z.enum(["reading", "review", "speaking"]),
    seconds: z.number().nonnegative(),
    count: z.number().int().nonnegative(),
    rating: z.enum(studyRatings).optional(),
    itemId: z.string().optional(),
    reviewSessionId: z.string().optional(),
    activitySessionId: z.string().optional(),
    origin: studyOriginSchema.optional(),
  }),
  base.extend({
    ...studyTutorContextSchema.shape,
    kind: z.literal("thread"),
    title: z.string(),
    keepVoiceTranscripts: z.boolean().optional(),
    followUp: followUpSchema.optional(),
    draft: studyTutorDraftSchema.optional(),
    messages: z.array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string(),
        citations: z.array(citation).optional(),
        at: z.number().optional(),
        practiceCardId: z.string().optional(),
        draftId: z.string().optional(),
        starter: z.literal(true).optional(),
      }),
    ),
    report: studyReportSchema.optional(),
    pastReports: z.array(studyReportSchema).optional(),
  }),
]);

export type StudyReport = z.infer<typeof studyReportSchema>;
export type StudyFollowUp = z.infer<typeof followUpSchema>;
export type StudyOrigin = z.infer<typeof studyOriginSchema>;
export type StudyCitation = z.infer<typeof citation>;
export type StudyRecord = z.infer<typeof studyRecordSchema>;
export type StudyRecordOf<K extends StudyRecord["kind"]> = Extract<StudyRecord, { kind: K }>;
export type StudyDocumentRecovery = z.infer<typeof studyDocumentDraftSchema>;
export type StudyDocumentSnapshot = z.infer<typeof documentDraftSnapshot>;
export type StudyHighlightColor = z.infer<typeof studyHighlightColor>;
export type StudyWord = StudyRecordOf<"word">;
export type StudyWordWrite =
  | { kind: "capture" | "edit"; word: StudyWord; vaultId: string }
  | { kind: "cards"; ids: string[]; vaultId: string; updatedAt: number };
export type StudyWordResult =
  | { kind: "word"; word: StudyWord }
  | { kind: "cards"; cardIds: string[] }
  | { kind: "duplicate" | "unavailable" };
export type StudyBook = StudyRecordOf<"book">;
export type StudyVisualOrigin = z.infer<typeof studyVisualOrigin>;
export type StudyImageContext = NonNullable<StudyThread["imageContext"]>;
export type StudyReadingPlace = z.infer<typeof readingPlace>;
export type StudyTextEdit = z.infer<typeof textEdit>;
export type StudyBookWrite = {
  id: string;
  change: Partial<
    Pick<
      StudyBook,
      "section" | "bookmarks" | "bookmarkPlaces" | "readingPlace" | "preferredReadingSurface" | "readingAppearance"
    >
  >;
  updatedAt: number;
};
export type StudyBookTextWrite = {
  id: string;
  sourceId: string;
  revision: number;
  previousText: string;
  previousMarkdown?: string;
  text: string;
  markdown?: string;
  edit: StudyTextEdit;
  updatedAt: number;
};
export type StudyThread = StudyRecordOf<"thread">;
export type StudyTutorDraft = z.infer<typeof studyTutorDraftSchema>;
export type StudyTutorDraftChange =
  | { kind: "save"; draft: StudyTutorDraft }
  | { kind: "consume"; id: string };
export type StudyThreadChange = Partial<
  Omit<StudyThread, "id" | "kind" | "messages" | "updatedAt" | "report" | "pastReports" | "draft" | "followUp">
>;
export type StudyReportChange =
  | { kind: "save"; report: StudyReport & { id: string }; practiceLanguage?: string | null }
  | { kind: "feedback"; reportId: string; key: string; helpful: boolean }
  | {
      kind: "step";
      reportId: string;
      index: number;
      action: "plan" | "remove" | "complete" | "reopen";
    };
export type StudyThreadWrite = {
  id: string;
  change: StudyThreadChange;
  append: StudyThread["messages"];
  updatedAt: number;
  report?: StudyReportChange;
  draft?: StudyTutorDraftChange;
};
export type StudySchedule = z.infer<typeof schedule>;
export type StudySection = z.infer<typeof section>;
export type StudyReviewWrite = {
  id: string;
  previousDueAt: number;
  schedule: StudySchedule;
  activity: StudyRecordOf<"session">;
};
export type StudyCardEdit = Pick<
  StudyRecordOf<"card">,
  "front" | "back" | "quizChoices" | "image" | "backImage" | "tags"
>;
export type StudyHighlightEdit = Pick<StudyRecordOf<"highlight">, "note" | "cue" | "color">;
export type StudyReviewItemWrite = {
  id: string;
  updatedAt: number;
} & (
  | { kind: "card"; change: StudyCardEdit }
  | { kind: "highlight"; change: StudyHighlightEdit }
);
export type StudyRating = (typeof studyRatings)[number];
