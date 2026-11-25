import { describe, expect, it } from "vitest";
import type { StudyBook, StudyPractice } from "./records";
import { todayPlan, type TodayPlanInput } from "./today-plan";

const now = Date.UTC(2026, 10, 25, 12);
const hour = 60 * 60 * 1000;

const book = (id: string, patch: Partial<StudyBook> = {}) =>
  ({
    id,
    kind: "book",
    title: id,
    section: 0,
    updatedAt: now - 100 * hour,
    sections: [{ title: "Chapter 1", text: "Words." }],
    ...patch,
  }) as unknown as StudyBook;

const open = { type: "write", answer: "", attempts: [] };
const session = (patch: Partial<StudyPractice> = {}) =>
  ({
    id: "s1",
    kind: "practice",
    mode: "questions",
    title: "Questions",
    updatedAt: now - hour,
    material: { origins: [] },
    questions: [open, open],
    ...patch,
  }) as unknown as StudyPractice;

const plan = (patch: Partial<TodayPlanInput>) =>
  todayPlan({
    books: [],
    sessions: [],
    now,
    due: 0,
    reviewPaused: false,
    doneToday: false,
    skipped: [],
    progressOf: () => 0.1,
    ...patch,
  });

const read = (id: string, hoursAgo: number) => book(id, { lastReadAt: now - hoursAgo * hour });

describe("todayPlan", () => {
  it("follows the rule in order", () => {
    const result = plan({
      books: [read("recent", 5), read("old", 100), book("fresh")],
      sessions: [session()],
      due: 12,
    });
    expect(result.steps.map(({ kind }) => kind)).toEqual([
      "resume-practice",
      "practise",
      "cards",
      "read",
      "new",
    ]);
    expect(result.next?.kind).toBe("resume-practice");
    expect(result.then).toHaveLength(3);
  });

  it("practises only what was read in the last 48 hours", () => {
    expect(plan({ books: [read("a", 47)] }).steps.map(({ kind }) => kind)).toEqual([
      "practise",
      "read",
    ]);
    expect(plan({ books: [read("a", 49)] }).steps.map(({ kind }) => kind)).toEqual(["read"]);
  });

  it("asks questions once a book was explained back", () => {
    const explained = session({
      mode: "teach",
      questions: [],
      updatedAt: now - 20 * 24 * hour,
      material: { origins: [{ kind: "book", bookId: "a" }] },
    } as never);
    const step = plan({ books: [read("a", 5)], sessions: [explained] }).next;
    expect(step).toMatchObject({ kind: "practise", mode: "questions" });
  });

  it("puts a paused review where an unfinished session goes, without a second cards step", () => {
    const result = plan({ books: [read("a", 100)], due: 4, reviewPaused: true });
    expect(result.steps.map(({ kind }) => kind)).toEqual(["resume-review", "read"]);
  });

  it("forgets sessions left more than a week ago and finished reading", () => {
    const old = session({ updatedAt: now - 8 * 24 * hour });
    const finished = book("done", { lastReadAt: now - 100 * hour });
    expect(plan({ books: [finished], sessions: [old], progressOf: () => 1 }).state).toBe("nothing");
  });

  it("hides a skipped step and promotes the next", () => {
    const books = [read("a", 100), book("fresh")];
    const first = plan({ books, due: 3 });
    expect(first.next?.kind).toBe("cards");
    const result = plan({ books, due: 3, skipped: ["cards"] });
    expect(result.next?.kind).toBe("read");
    expect(result.hidden.map(({ id }) => id)).toEqual(["cards"]);
    expect(result.then.map(({ kind }) => kind)).toEqual(["new"]);
  });

  it("is first-time with no material and nothing to offer", () => {
    expect(plan({}).state).toBe("first-time");
  });

  it("is done once something was studied and nothing urgent is left", () => {
    const result = plan({ books: [read("a", 100)], doneToday: true });
    expect(result.state).toBe("done");
    expect(result.next).toBeUndefined();
    expect(result.steps.map(({ kind }) => kind)).toEqual(["read"]);
  });

  it("stays open after studying while cards are still due", () => {
    expect(plan({ books: [read("a", 100)], doneToday: true, due: 2 }).state).toBe("step");
  });
});
