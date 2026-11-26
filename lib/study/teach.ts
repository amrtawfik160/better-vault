import { z } from "zod";
import {
  maxTeachExplanation,
  studyPracticeAudiences,
  studyTeachAnalysisSchema,
  studyTeachIdeaStatuses,
  type StudyOrigin,
  type StudyPractice,
  type StudyPracticePassage,
  type StudyTeachAnalysis,
  type StudyTeachIdea,
  type StudyTeachIdeaStatus,
  type StudyTeachRound,
} from "./records";
import { studyTextWindows } from "./text-windows";

/* ----------------------------------------------------------------------------
 * Material: how much of a long book or transcript goes with each request.
 * ------------------------------------------------------------------------- */

/** Budgets for the passages a session keeps, by mode. Teach it back needs the whole arc of the material. */
export const practiceMaterialBudgets = {
  questions: { total: 10_500, window: 1_500, passages: 8 },
  teach: { total: 40_000, window: 5_000, passages: 16 },
} as const;

export type MaterialSection = { title: string; text: string; origin: Extract<StudyOrigin, { kind: "book" }> };

/**
 * The passages for a span of a book's sections. When they fit the budget all
 * of the text goes. Otherwise windows are taken at even steps from start to
 * end, as many as fit, and an outline of every section's title is added, so
 * the model sees the whole arc of a long transcript and the same passages are
 * used in every round.
 */
export function bookMaterialPassages(
  sections: readonly MaterialSection[],
  budget: { total: number; window: number; passages: number },
): { passages: StudyPracticePassage[]; sampled: boolean } {
  const windows = sections.flatMap(({ title, text, origin }) =>
    [...studyTextWindows(text, budget.window)].map((part) => ({
      title,
      text: part.text,
      origin: { ...origin, offset: part.offset, length: part.text.length },
    })),
  );
  const size = (picked: readonly { text: string }[]) => picked.reduce((total, { text }) => total + text.length, 0);
  if (windows.length <= budget.passages && size(windows) <= budget.total) return { passages: windows, sampled: false };
  const outline = {
    title: "Outline of the whole material",
    text: sections.map(({ title }, index) => `${index + 1}. ${title}`).join("\n").slice(0, 3_000),
  };
  const room = budget.total - (sections.length > 1 ? outline.text.length : 0);
  for (let count = Math.min(budget.passages - 1, windows.length); count > 0; count--) {
    const step = count === 1 ? 0 : (windows.length - 1) / (count - 1);
    const picked = [...new Set(Array.from({ length: count }, (_, index) => Math.round(index * step)))].map(
      (index) => windows[index],
    );
    if (size(picked) <= room || count === 1)
      return { passages: sections.length > 1 ? [...picked, outline] : picked, sampled: true };
  }
  return { passages: [], sampled: false };
}

/* ----------------------------------------------------------------------------
 * The analysis request and reply
 * ------------------------------------------------------------------------- */

const previousIdea = z.object({
  title: z.string().max(300),
  quote: z.string().max(1_000),
  citations: z.array(z.number().int().positive()).max(3).optional(),
  status: z.enum(studyTeachIdeaStatuses),
});
export const teachRequestFields = {
  explanation: z.string().trim().min(1).max(maxTeachExplanation),
  round: z.number().int().min(1).max(100),
  /** The previous round's key ideas and verdicts, so this round keeps the same list and can compare. */
  previous: z
    .object({ ideas: z.array(previousIdea).min(1).max(12), summary: z.string().max(2_000) })
    .optional(),
  translateTo: z.string().max(35).optional(),
};
export const teachRequestSchema = z.object({
  audience: z.enum(studyPracticeAudiences),
  scenario: z.string().optional(),
  passages: z.array(z.object({ title: z.string(), text: z.string() })),
  ...teachRequestFields,
});
export type TeachRequest = z.output<typeof teachRequestSchema>;

const citations = z.array(z.number());
export const teachReplySchema = z.object({
  ideas: z.array(
    z.object({ title: z.string(), quote: z.string(), citations, status: z.enum(studyTeachIdeaStatuses), note: z.string() }),
  ),
  misconceptions: z.array(z.object({ said: z.string(), source: z.string(), why: z.string(), citations })),
  teaching: z.array(z.string()),
  summary: z.string(),
  accuracy: z.number(),
  progress: z.string(),
  questions: z.array(z.object({ prompt: z.string(), reference: z.string(), keyPoints: z.array(z.string()), citations })),
  language: z.array(z.object({ original: z.string(), suggestion: z.string(), reason: z.string() })),
  vocabulary: z.array(z.object({ term: z.string(), meaning: z.string(), translation: z.string(), example: z.string() })),
});
export type TeachReply = z.infer<typeof teachReplySchema>;

const probingQuestion = z.object({
  prompt: z.string(),
  reference: z.string(),
  keyPoints: z.array(z.string()),
  citations: z.array(z.number().int().positive()).optional(),
});
export type TeachProbingQuestion = z.infer<typeof probingQuestion>;

/** What the route answers for a round. */
export const teachAnswerSchema = z.object({
  analysis: studyTeachAnalysisSchema,
  questions: z.array(probingQuestion),
});

export function teachSystemLines(request: TeachRequest) {
  return [
    "The learner is teaching back material they studied (a book, a course, a video or podcast transcript) to prove they understand it. The passages are the source; the explanation is the learner's own words.",
    request.previous
      ? "previous holds the key ideas from the learner's last round. Keep exactly these ideas, in the same order, with the same titles, quotes and citations, and judge each again against the new explanation."
      : "First, identify the 5 to 12 key ideas of the source that someone who understood it must be able to explain, in the source's order. Give each a short title, a short verbatim quote from the passages that states it, and the passage numbers in citations. Ignore asides, adverts and small talk in transcripts. An outline passage only shows the structure; do not quote it.",
    "For each key idea set status: explained when the learner got it right and clear, partial when it is there but vague, incomplete or confused, wrong when the learner states it incorrectly, missing when the explanation does not mention it. note says in one line what was good or what is missing or wrong.",
    "misconceptions lists each incorrect claim: said (what the learner said, quoted or closely paraphrased), source (what the source actually says), why (why the difference matters), and citations. Use an empty array when there are none.",
    "teaching gives two to four concrete pieces of advice on how the learner taught it for this audience: structure and order, examples or analogies, jargon, concision. Name what to change, not general praise.",
    "summary is two or three sentences on how well the learner understands the material overall. accuracy rates what they said from 1 (mostly wrong) to 5 (all correct), separate from how much they covered.",
    request.previous
      ? "progress says in one or two sentences what improved since the previous round and what is still missing."
      : "Leave progress empty.",
    "questions asks two or three probing, Socratic questions that target the biggest gaps or misconceptions: make the learner reason, connect ideas or apply them to an example, never ask for trivia. For each give a model reference answer and two to four keyPoints, with citations.",
    "language lists up to five real English mistakes or awkward phrases from the explanation (original, suggestion, short reason); use an empty array when the English is fine.",
    `vocabulary suggests up to four words or phrases that would make the explanation more precise, each with a meaning, an example from this topic and ${request.translateTo ? `a translation into ${request.translateTo}` : "an empty translation"}.`,
    request.passages.length
      ? "Cite passages by their numbers; never cite a number that was not supplied."
      : "No passages were supplied: use general knowledge of the topic and leave every citations array empty.",
  ];
}

export function teachPrompt(request: TeachRequest) {
  return JSON.stringify({
    round: request.round,
    scenario: request.scenario?.trim() || undefined,
    explanation: request.explanation,
    previous: request.previous,
    passages: request.passages.map((passage, index) => ({ number: index + 1, ...passage })),
  });
}

/* ----------------------------------------------------------------------------
 * Tidying the reply and comparing rounds
 * ------------------------------------------------------------------------- */

const maxIdeas = 12;
function cited(numbers: readonly number[], passages: number) {
  const valid = [...new Set(numbers.filter((n) => Number.isInteger(n) && n >= 1 && n <= passages))].slice(0, 3);
  return valid.length ? { citations: valid } : {};
}
const key = (text: string) => text.trim().toLowerCase().replace(/\s+/gu, " ");
function texts(items: readonly string[], limit: number) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, limit);
}

/**
 * Keeps a later round's ideas the same as the previous round's: matched by
 * title, else by position; an idea the model dropped counts as missing.
 */
export function alignTeachIdeas(
  previous: readonly Pick<StudyTeachIdea, "title" | "quote" | "citations">[],
  ideas: readonly Pick<StudyTeachIdea, "title" | "status" | "note">[],
): StudyTeachIdea[] {
  const byTitle = new Map(ideas.map((idea) => [key(idea.title), idea]));
  const titles = new Set(previous.map(({ title }) => key(title)));
  const used = new Set<(typeof ideas)[number]>();
  return previous.map((idea, index) => {
    let match = byTitle.get(key(idea.title));
    if (match && used.has(match)) match = undefined;
    const positioned = ideas[index];
    if (!match && positioned && !used.has(positioned) && !titles.has(key(positioned.title))) match = positioned;
    if (match) used.add(match);
    return {
      title: idea.title,
      quote: idea.quote,
      ...(idea.citations?.length ? { citations: idea.citations } : {}),
      status: match?.status ?? "missing",
      note: match?.note.trim() ?? "",
    };
  });
}

export function normaliseTeachReply(
  reply: TeachReply,
  { passages, previous }: { passages: number; previous?: TeachRequest["previous"] },
): { analysis: StudyTeachAnalysis; questions: TeachProbingQuestion[] } {
  const fresh = reply.ideas.flatMap((idea) => {
    const title = idea.title.trim();
    return title
      ? [{ title, quote: idea.quote.trim(), ...cited(idea.citations, passages), status: idea.status, note: idea.note.trim() }]
      : [];
  });
  const ideas = previous ? alignTeachIdeas(previous.ideas, fresh) : fresh.slice(0, maxIdeas);
  const progress = reply.progress.trim();
  return {
    analysis: {
      ideas,
      misconceptions: reply.misconceptions
        .map((item) => ({ said: item.said.trim(), source: item.source.trim(), why: item.why.trim(), ...cited(item.citations, passages) }))
        .filter(({ said, source }) => said && source)
        .slice(0, 6),
      teaching: texts(reply.teaching, 4),
      summary: reply.summary.trim(),
      accuracy: Math.min(5, Math.max(1, Math.round(Number.isFinite(reply.accuracy) ? reply.accuracy : 1))),
      ...(previous && progress ? { progress } : {}),
      language: reply.language
        .map((item) => ({ original: item.original.trim(), suggestion: item.suggestion.trim(), reason: item.reason.trim() }))
        .filter(({ original, suggestion }) => original && suggestion && original !== suggestion)
        .slice(0, 5),
      vocabulary: reply.vocabulary
        .map((item) => ({ term: item.term.trim(), meaning: item.meaning.trim(), translation: item.translation.trim(), example: item.example.trim() }))
        .filter(({ term }) => term)
        .slice(0, 4),
    },
    questions: reply.questions
      .flatMap((question) => {
        const prompt = question.prompt.trim();
        return prompt
          ? [{ prompt, reference: question.reference.trim(), keyPoints: texts(question.keyPoints, 4), ...cited(question.citations, passages) }]
          : [];
      })
      .slice(0, 3),
  };
}

const statusRank: Record<StudyTeachIdeaStatus, number> = { wrong: 0, missing: 0, partial: 1, explained: 2 };

/** The share of key ideas the learner explained correctly and clearly, 0 to 1. */
export function teachCoverage(ideas: readonly Pick<StudyTeachIdea, "status">[]) {
  return ideas.length ? ideas.filter(({ status }) => status === "explained").length / ideas.length : 0;
}

export function teachStatusCounts(ideas: readonly Pick<StudyTeachIdea, "status">[]) {
  const counts: Record<StudyTeachIdeaStatus, number> = { explained: 0, partial: 0, wrong: 0, missing: 0 };
  for (const { status } of ideas) counts[status]++;
  return counts;
}

/** How one round compares with the one before: coverage, and which ideas moved. */
export function compareTeachRounds(previous: StudyTeachAnalysis, current: StudyTeachAnalysis) {
  const before = new Map(previous.ideas.map((idea) => [key(idea.title), idea.status]));
  const improved: string[] = [];
  const slipped: string[] = [];
  for (const idea of current.ideas) {
    const earlier = before.get(key(idea.title));
    if (!earlier) continue;
    if (statusRank[idea.status] > statusRank[earlier]) improved.push(idea.title);
    else if (statusRank[idea.status] < statusRank[earlier]) slipped.push(idea.title);
  }
  return {
    coverageBefore: teachCoverage(previous.ideas),
    coverageAfter: teachCoverage(current.ideas),
    accuracyBefore: previous.accuracy,
    accuracyAfter: current.accuracy,
    improved,
    slipped,
    remaining: current.ideas.filter(({ status }) => status !== "explained").map(({ title }) => title),
  };
}

/** Ideas still not explained in the latest analysed round: what flashcards are made from. */
export function teachGaps(session: Pick<StudyPractice, "rounds">) {
  const analysis = latestTeachAnalysis(session);
  return analysis ? analysis.ideas.filter(({ status }) => status !== "explained") : [];
}

export function latestTeachAnalysis(session: Pick<StudyPractice, "rounds">) {
  return session.rounds?.findLast(({ analysis }) => analysis)?.analysis;
}

/** The analysed rounds, in order. */
export function analysedTeachRounds(session: Pick<StudyPractice, "rounds">) {
  return (session.rounds ?? []).filter((round): round is StudyTeachRound & { analysis: StudyTeachAnalysis } =>
    Boolean(round.analysis),
  );
}

/** The previous round in the form the next request sends it. */
export function teachPrevious(analysis: StudyTeachAnalysis | undefined): TeachRequest["previous"] {
  if (!analysis?.ideas.length) return;
  return {
    ideas: analysis.ideas.slice(0, maxIdeas).map(({ title, quote, citations, status }) => ({
      title: title.slice(0, 300),
      quote: quote.slice(0, 1_000),
      ...(citations?.length ? { citations: citations.slice(0, 3) } : {}),
      status,
    })),
    summary: analysis.summary.slice(0, 2_000),
  };
}
