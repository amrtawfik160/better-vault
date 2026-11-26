import { describe, expect, it } from "vitest";
import { originHref } from "./links";
import type { StudyOrigin, StudyRecordOf, StudyReport, StudyWord } from "./records";
import { reportSuggestionId, savedReportSuggestions } from "./reports";
import { freshSchedule } from "./schedule";

const threadId = "tutor";
const report = {
  id: "report",
  summary: "Practice agreement",
  corrections: [],
  nextSteps: [],
  languageFeedback: [
    { original: "The replicas agrees", suggestion: "The replicas agree", reason: "Plural subject" },
  ],
  vocabulary: [
    {
      term: "Quorum",
      language: "English",
      example: "A quorum approved the write.",
      definition: "Minimum subset required",
      translation: "",
    },
  ],
} satisfies StudyReport;
const origin = { kind: "report", threadId, reportId: report.id } satisfies StudyOrigin;

const word = {
  id: "existing word",
  kind: "word",
  term: "quorum",
  language: "english",
  context: "Previously captured",
  note: "",
  translation: "",
  updatedAt: 1,
} satisfies StudyWord;

describe("saved report suggestions", () => {
  it("opens a legacy card and a vocabulary term with a merged legacy example", () => {
    const card = {
      id: reportSuggestionId("card", threadId, report, "language-0"),
      kind: "card",
      front: "Edited question",
      back: "Edited answer",
      origin,
      tags: [],
      schedule: freshSchedule(1),
      updatedAt: 1,
    } satisfies StudyRecordOf<"card">;
    const words = [{ ...word, examples: [{ context: report.vocabulary[0].example, origin }] }];
    const suggestions = savedReportSuggestions({ threadId, report, words, cards: [card] });
    expect(suggestions.get("language-0")).toEqual({ kind: "card", cardId: card.id });
    expect(suggestions.get("word-0")).toEqual({ kind: "word", wordId: word.id });
    expect(
      savedReportSuggestions({
        threadId,
        report: { ...report, id: "other report" },
        words,
        cards: [card],
      }).size,
    ).toBe(0);
  });

  it("preserves the link after editing a merged word and leaves other suggestions available", () => {
    const exact = { ...origin, suggestion: "word-0" };
    const edited = {
      ...word,
      term: "Custom name",
      examples: [{ context: "Custom example", origin: exact }],
    };
    const repeated = { ...report, vocabulary: [...report.vocabulary, ...report.vocabulary] };
    const suggestions = savedReportSuggestions({
      threadId,
      report: repeated,
      words: [edited],
      cards: [],
    });
    expect([...suggestions]).toEqual([["word-0", { kind: "word", wordId: edited.id }]]);
    expect(new URL(originHref(exact), "https://deeple.test").searchParams.get("suggestion")).toBe(
      "word-0",
    );
    expect(savedReportSuggestions({ threadId, report, words: [], cards: [] }).size).toBe(0);
  });
});
