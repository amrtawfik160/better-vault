import { describe, expect, it } from "vitest";
import { movedStudyImageId, studyBookMerge } from "./book-merge";
import { duplicateBooksFixture, expectMergedFixture } from "./book-merge.fixture";
import { studyDocumentDraftId } from "./document-drafts";
import type { StudyBook, StudyRecord } from "./records";

function applied(rows: readonly StudyRecord[]) {
  const plan = studyBookMerge(rows);
  const next = new Map(rows.map((row) => [row.id, row]));
  for (const id of plan.remove) next.delete(id);
  for (const row of plan.put) next.set(row.id, row);
  return { rows: [...next.values()], plan };
}

describe("Study book merge", () => {
  it("merges the books of one source into the oldest and re-points what was made from the others", () => {
    const { study, blobs } = duplicateBooksFixture();
    const { rows, plan } = applied(study);
    expect(plan.moved).toEqual(new Map([["source-s1", "imported"]]));
    expectMergedFixture(rows, blobs.map(({ id }) => movedStudyImageId(id, plan.moved) ?? id));
  });

  it("changes nothing the second time", () => {
    const { rows } = applied(duplicateBooksFixture().study);
    expect(studyBookMerge(rows)).toEqual({ put: [], remove: [], moved: new Map() });
  });

  it("only drops attachedToNotebook when no source has two books", () => {
    const { study } = duplicateBooksFixture();
    const single = study.filter((row) => row.id !== "source-s1");
    const plan = studyBookMerge(single);
    expect(plan.remove).toEqual([]);
    expect(plan.moved.size).toBe(0);
    expect(plan.put.map(({ id }) => id).sort()).toEqual(["attached", "imported", "orphan"]);
    for (const row of plan.put) expect(row).not.toHaveProperty("attachedToNotebook");
  });

  it("keeps the earliest used of two books opened from the same source, and the kept book's own draft", () => {
    const book = (id: string, updatedAt: number): StudyBook => ({
      id, kind: "book", notebookId: "n", sourceId: "s", title: "T", format: "pdf",
      sections: [{ title: "1", text: "" }, { title: "2", text: "" }], section: 1, bookmarks: [1], updatedAt,
    });
    const draft = (bookId: string, version: string) => ({
      id: studyDocumentDraftId({ bookId, section: 0 }), kind: "document-draft", bookId, version, snapshot: null, updatedAt: 1000,
    }) as const;
    const { rows, plan } = applied([
      book("b", 900),
      book("a", 50),
      { id: "visit", kind: "session", activity: "reading", seconds: 5, count: 1, origin: { kind: "book", bookId: "b" }, updatedAt: 10 },
      draft("a", "merged-away"),
      draft("b", "kept"),
    ]);
    expect(plan.moved).toEqual(new Map([["a", "b"]]));
    expect(rows.find(({ id }) => id === "b")).toMatchObject({ bookmarks: [1], section: 1, mergedIds: ["a"] });
    expect(rows.find(({ id }) => id === draft("b", "").id)).toMatchObject({ version: "kept" });
    // The merged-away book's draft stays as it was rather than overwrite the kept one's.
    expect(rows.find(({ id }) => id === draft("a", "").id)).toMatchObject({ version: "merged-away", bookId: "a" });
  });

  it("moves only the pictures of merged-away books", () => {
    const moved = new Map([["a:b", "c"]]);
    expect(movedStudyImageId("study-image:a%3Ab:0:pdf:0", moved)).toBe("study-image:c:0:pdf:0");
    expect(movedStudyImageId("study-image:a:0:pdf:0", moved)).toBeUndefined();
  });
});
