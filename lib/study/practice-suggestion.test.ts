import { describe, expect, it } from "vitest";
import { practiceSuggestion, unfinishedPractice } from "./practice-suggestion";
import type { StudyBook, StudyPractice } from "./records";

const now = Date.UTC(2026, 10, 25, 12);
const day = 24 * 60 * 60 * 1000;

const book = (id: string, lastReadAt?: number, sections = 3) =>
  ({
    id,
    kind: "book",
    title: id,
    lastReadAt,
    section: 1,
    sections: Array.from({ length: sections }, (_, at) => ({ title: `Chapter ${at + 1}`, text: "Words." })),
  }) as unknown as StudyBook;

const session = (patch: Partial<StudyPractice>) =>
  ({
    id: "p1",
    kind: "practice",
    mode: "questions",
    title: "Questions",
    updatedAt: now - day,
    material: { origins: [] },
    questions: [],
    ...patch,
  }) as unknown as StudyPractice;

const open = { type: "write", answer: "", attempts: [] };

describe("practiceSuggestion", () => {
  it("offers to finish a session left this week first", () => {
    const left = session({ questions: [open, open] as never });
    expect(practiceSuggestion({ books: [book("a", now - day)], sessions: [left], now })).toMatchObject({
      kind: "resume",
      session: { id: "p1" },
      answered: 0,
      total: 2,
    });
  });

  it("forgets sessions left more than a week ago", () => {
    const old = session({ questions: [open] as never, updatedAt: now - 8 * day });
    expect(practiceSuggestion({ books: [], sessions: [old], now })).toBeNull();
  });

  it("asks to explain back what was read last, then questions once it was explained", () => {
    const books = [book("older", now - 3 * day), book("latest", now - day)];
    expect(practiceSuggestion({ books, sessions: [], now })).toMatchObject({
      kind: "start",
      mode: "teach",
      book: { id: "latest" },
      section: 1,
    });
    const explained = session({
      mode: "teach",
      rounds: [{ analysis: { ideas: [] } }] as never,
      material: { origins: [{ kind: "book", bookId: "latest" }] },
    });
    expect(practiceSuggestion({ books, sessions: [explained], now })).toMatchObject({
      mode: "questions",
      book: { id: "latest" },
    });
  });

  it("suggests nothing without recent reading", () => {
    expect(practiceSuggestion({ books: [book("a"), book("b", now - 30 * day)], sessions: [], now })).toBeNull();
  });

  it("leaves out the chapter for a document without chapters", () => {
    expect(practiceSuggestion({ books: [book("a", now, 1)], sessions: [], now })).toMatchObject({
      section: undefined,
    });
  });
});

describe("unfinishedPractice", () => {
  it("counts an explanation never sent, and questions left unanswered", () => {
    expect(unfinishedPractice(session({ mode: "teach", rounds: [] }))).toBe(true);
    expect(unfinishedPractice(session({ questions: [open] as never }))).toBe(true);
    expect(unfinishedPractice(session({ questions: [] }))).toBe(false);
  });
});
