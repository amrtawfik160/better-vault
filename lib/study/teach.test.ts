import { describe, expect, it } from "vitest";
import { practicePrompt, practiceRequestSchema, practiceSystemPrompt } from "./writing-practice";
import { studyRecordSchema, type StudyPractice, type StudyTeachAnalysis, type StudyTeachIdea } from "./records";
import {
  alignTeachIdeas,
  bookMaterialPassages,
  compareTeachRounds,
  normaliseTeachReply,
  practiceMaterialBudgets,
  teachCoverage,
  teachGaps,
  teachPrevious,
  type TeachReply,
} from "./teach";

const idea = (title: string, status: StudyTeachIdea["status"] = "missing"): StudyTeachIdea => ({
  title,
  quote: `${title} quote`,
  citations: [1],
  status,
  note: "",
});
const analysis = (ideas: StudyTeachIdea[], accuracy = 3): StudyTeachAnalysis => ({
  ideas,
  misconceptions: [],
  teaching: [],
  summary: "",
  accuracy,
  language: [],
  vocabulary: [],
});

describe("bookMaterialPassages", () => {
  const origin = (section: number) => ({ kind: "book" as const, bookId: "b", section, revision: 0 });

  it("sends short material whole, pointing each passage at its place in the book", () => {
    const { passages, sampled } = bookMaterialPassages(
      [{ title: "Ch 1", text: "First idea.", origin: origin(0) }, { title: "Ch 2", text: "Second idea.", origin: origin(1) }],
      practiceMaterialBudgets.teach,
    );
    expect(sampled).toBe(false);
    expect(passages).toEqual([
      { title: "Ch 1", text: "First idea.", origin: { ...origin(0), offset: 0, length: 11 } },
      { title: "Ch 2", text: "Second idea.", origin: { ...origin(1), offset: 0, length: 12 } },
    ]);
  });

  it("spreads a long transcript evenly from start to end within the budget, with an outline", () => {
    const hour = Array.from({ length: 600 }, (_, index) => `Minute ${index} says something worth hearing.`).join("\n").repeat(3);
    const sections = [
      { title: "Part 1", text: hour, origin: origin(0) },
      { title: "Part 2", text: hour, origin: origin(1) },
    ];
    const budget = practiceMaterialBudgets.teach;
    const { passages, sampled } = bookMaterialPassages(sections, budget);
    expect(sampled).toBe(true);
    expect(passages.reduce((total, { text }) => total + text.length, 0)).toBeLessThanOrEqual(budget.total);
    expect(passages.length).toBeLessThanOrEqual(budget.passages);
    expect(passages.at(-1)).toEqual({ title: "Outline of the whole material", text: "1. Part 1\n2. Part 2" });
    const placed = passages.flatMap(({ origin: at }) => (at?.kind === "book" ? [at] : []));
    expect(placed[0]).toMatchObject({ section: 0, offset: 0 });
    expect(placed.at(-1)?.section).toBe(1);
    expect(bookMaterialPassages(sections, budget)).toEqual({ passages, sampled });
  });
});

describe("teach requests and prompts", () => {
  const request = (fields: object = {}) =>
    practiceRequestSchema.parse({
      action: "teach",
      audience: "friend",
      explanation: "It goes 1, 2, 3.",
      round: 1,
      passages: [{ title: "Transcript", text: "One, two, three." }],
      ...fields,
    });

  it("asks for key ideas in the first round and keeps them in later rounds", () => {
    expect(practiceSystemPrompt(request())).toContain("identify the 5 to 12 key ideas");
    const later = request({ round: 2, previous: teachPrevious(analysis([idea("Order matters", "partial")])) });
    const system = practiceSystemPrompt(later);
    expect(system).toContain("Keep exactly these ideas");
    expect(system).toContain("what improved since the previous round");
    expect(system).toContain("never heard of the topic");
    expect(JSON.parse(practicePrompt(later)).previous.ideas).toEqual([
      { title: "Order matters", quote: "Order matters quote", citations: [1], status: "partial" },
    ]);
  });

  it("refuses an empty explanation", () => {
    expect(practiceRequestSchema.safeParse({ action: "teach", audience: "friend", explanation: " ", round: 1 }).success).toBe(false);
  });
});

const reply = (fields: Partial<TeachReply> = {}): TeachReply => ({
  ideas: [],
  misconceptions: [],
  teaching: [],
  summary: " Good start. ",
  accuracy: 7,
  progress: "Better.",
  questions: [],
  language: [],
  vocabulary: [],
  ...fields,
});

describe("normaliseTeachReply", () => {
  it("tidies the first round: citations in range, at most three questions, no progress", () => {
    const { analysis: result, questions } = normaliseTeachReply(
      reply({
        ideas: [{ title: " Idea ", quote: "q", citations: [1, 5], status: "partial", note: " n " }, { title: "", quote: "", citations: [], status: "missing", note: "" }],
        misconceptions: [{ said: "X", source: "Y", why: "Z", citations: [2] }, { said: "", source: "Y", why: "", citations: [] }],
        questions: Array.from({ length: 4 }, (_, index) => ({ prompt: `Why ${index}?`, reference: "r", keyPoints: ["k"], citations: [1] })),
      }),
      { passages: 1 },
    );
    expect(result.ideas).toEqual([{ title: "Idea", quote: "q", citations: [1], status: "partial", note: "n" }]);
    expect(result.misconceptions).toEqual([{ said: "X", source: "Y", why: "Z" }]);
    expect(result.accuracy).toBe(5);
    expect(result.progress).toBeUndefined();
    expect(questions).toHaveLength(3);
  });

  it("keeps the previous round's ideas and marks one the model dropped as missing", () => {
    const previous = teachPrevious(analysis([idea("A"), idea("B"), idea("C")]));
    const { analysis: result } = normaliseTeachReply(
      reply({
        ideas: [
          { title: "b", quote: "changed", citations: [], status: "explained", note: "Now clear" },
          { title: "A", quote: "", citations: [], status: "partial", note: "" },
          { title: "New idea", quote: "", citations: [], status: "explained", note: "" },
        ],
      }),
      { passages: 1, previous },
    );
    expect(result.ideas.map(({ title, status, quote }) => [title, status, quote])).toEqual([
      ["A", "partial", "A quote"],
      ["B", "explained", "B quote"],
      ["C", "explained", "C quote"],
    ]);
    expect(result.progress).toBe("Better.");
  });
});

describe("comparing rounds", () => {
  it("matches ideas by title, else by place, without claiming another idea's match", () => {
    const aligned = alignTeachIdeas([idea("A"), idea("B")], [{ title: "B", status: "explained", note: "" }, { title: "Other", status: "partial", note: "" }]);
    expect(aligned.map(({ status }) => status)).toEqual(["missing", "explained"]);
  });

  it("reports coverage before and after and the ideas that moved", () => {
    const first = analysis([idea("A", "explained"), idea("B", "missing"), idea("C", "partial"), idea("D", "wrong"), idea("E", "explained")], 2);
    const second = analysis([idea("A", "partial"), idea("B", "explained"), idea("C", "explained"), idea("D", "missing"), idea("E", "explained")], 4);
    expect(teachCoverage(first.ideas)).toBe(0.4);
    expect(compareTeachRounds(first, second)).toEqual({
      coverageBefore: 0.4,
      coverageAfter: 0.6,
      accuracyBefore: 2,
      accuracyAfter: 4,
      improved: ["B", "C"],
      slipped: ["A"],
      remaining: ["A", "D"],
    });
  });

  it("makes gaps from the latest analysed round", () => {
    const session = {
      rounds: [
        { id: "1", at: 1, explanation: "x", analysis: analysis([idea("A", "missing")]), questions: [] },
        { id: "2", at: 2, explanation: "y", analysis: analysis([idea("A", "explained"), idea("B", "wrong")]), questions: [] },
        { id: "3", at: 3, explanation: "draft", questions: [] },
      ],
    } satisfies Pick<StudyPractice, "rounds">;
    expect(teachGaps(session).map(({ title }) => title)).toEqual(["B"]);
  });

  it("stores a teach session through the study schema", () => {
    const saved: StudyPractice = {
      id: "t",
      kind: "practice",
      mode: "teach",
      vaultId: "default",
      title: "Podcast",
      createdAt: 1,
      updatedAt: 1,
      audience: "friend",
      material: { origins: [{ kind: "book", bookId: "b" }], sampled: true },
      passages: [],
      types: ["write"],
      questions: [],
      rounds: [{ id: "r", at: 1, explanation: "It goes…", analysis: analysis([idea("A")]), questions: [] }],
    };
    expect(studyRecordSchema.parse(saved)).toEqual(saved);
  });
});
