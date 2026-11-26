import { describe, expect, it } from "vitest";
import type { StudyRecord } from "./records";
import { sharedStudyVault, studyIdsByVault, studyVaultViews } from "./review-vaults";

const schedule = { dueAt: 0, intervalDays: 0, repetitions: 0, ease: 2.5 };
const card = (id: string, vaultId: string): StudyRecord =>
  ({ id, kind: "card", front: "a", back: "b", tags: [], schedule, vaultId, updatedAt: 0 });
const row = (id: string, kind: "word" | "book" | "thread" | "session", vaultId: string) =>
  ({ id, kind, vaultId, updatedAt: 0 }) as unknown as StudyRecord;
const rows: StudyRecord[] = [
  card("card-here", "here"),
  card("card-there", "there"),
  row("word-there", "word", "there"),
  row("book-there", "book", "there"),
  row("thread-there", "thread", "there"),
  row("review-there", "session", "there"),
  row("thread-here", "thread", "here"),
];
const owner = (entry: StudyRecord) => entry.vaultId ?? "here";
const ids = (list: readonly StudyRecord[]) => list.map(({ id }) => id);

describe("Study rows across vaults", () => {
  it("keeps every part in the current vault while the setting is off", () => {
    const views = studyVaultViews(rows, owner, "here", false);
    expect(ids(views.rows)).toEqual(["card-here", "thread-here"]);
    expect(views.review).toEqual(views.rows);
    expect(views.collection).toEqual(views.rows);
  });

  it("adds other vaults' review items to Review and their words to the Collection, nothing else", () => {
    const views = studyVaultViews(rows, owner, "here", true);
    expect(ids(views.rows)).toEqual(["card-here", "thread-here"]);
    expect(ids(views.review)).toEqual([
      "card-here", "card-there", "word-there", "book-there", "review-there", "thread-here",
    ]);
    expect(ids(views.collection)).toEqual(["card-here", "word-there", "thread-here"]);
    expect(views.review.find(({ id }) => id === "card-there")).toBe(rows[1]);
  });

  it("groups ids by vault for writes that act in one vault", () => {
    expect(studyIdsByVault(rows.slice(0, 3), owner)).toEqual([
      ["here", ["card-here"]],
      ["there", ["card-there", "word-there"]],
    ]);
  });

  it("names the one vault a selection is in, and falls back for mixed or missing items", () => {
    expect(sharedStudyVault(["card-there", "word-there"], rows, owner, "here")).toBe("there");
    expect(sharedStudyVault(["card-there", "card-here"], rows, owner, "here")).toBe("here");
    expect(sharedStudyVault(["card-there", "gone"], rows, owner, "elsewhere")).toBe("elsewhere");
  });
});
