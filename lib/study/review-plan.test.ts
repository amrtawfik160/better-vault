import { describe, expect, it } from "vitest";
import type { StudyBook, StudyRecordOf } from "./records";
import { reviewPlan, reviewPlanIds } from "./review-plan";

const now = 1_000_000;
const card = (id: string, dueAt: number, patch: object = {}) =>
  ({ id, kind: "card", front: id, back: "", tags: [], updatedAt: 0, schedule: { dueAt }, ...patch }) as unknown as StudyRecordOf<"card">;
const highlight = (id: string, dueAt: number, bookId: string) =>
  ({ id, kind: "highlight", bookId, section: 0, quote: "", updatedAt: 0, schedule: { dueAt } }) as unknown as StudyRecordOf<"highlight">;
const books = [
  { id: "campbell", title: "Campbell Biology", notebookId: "bio" },
  { id: "sombra", title: "La sombra del viento", notebookId: "es" },
] as unknown as StudyBook[];

describe("reviewPlan", () => {
  it("groups what is due by notebook, the most due first, with the document most cards come from", () => {
    const plan = reviewPlan(
      [
        card("c1", now - 10, { notebookId: "bio", origin: { kind: "book", bookId: "campbell" } }),
        card("c2", now - 5, { notebookId: "bio" }),
        card("c3", now + 1000, { notebookId: "bio" }),
        card("w1", now - 1, { origin: { kind: "word", wordId: "x" }, notebookId: "es" }),
        highlight("h1", now - 2, "sombra"),
        card("m1", now + 5000, { notebookId: "mom" }),
      ],
      books,
      now,
    );
    expect(plan.map(({ notebookId, due }) => [notebookId, due.length])).toEqual([
      ["bio", 2],
      ["es", 2],
      ["mom", 0],
    ]);
    expect(plan[0]).toMatchObject({ cards: 2, total: 3, from: "Campbell Biology" });
    expect(plan[1]).toMatchObject({ words: 1, highlights: 1, from: "La sombra del viento" });
  });

  it("keeps items of no notebook together", () => {
    expect(reviewPlan([card("loose", now - 1)], books, now)[0].notebookId).toBe("");
  });
});

describe("reviewPlanIds", () => {
  it("lists the due items of the ticked notebooks, a notebook at a time", () => {
    const plan = reviewPlan(
      [card("a", now - 1, { notebookId: "bio" }), card("b", now - 3, { notebookId: "es" }), card("c", now - 2, { notebookId: "bio" })],
      books,
      now,
    );
    expect(reviewPlanIds(plan, new Set(["bio", "es"]))).toEqual(["c", "a", "b"]);
    expect(reviewPlanIds(plan, new Set(["es"]))).toEqual(["b"]);
  });
});
