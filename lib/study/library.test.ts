import { describe, expect, it } from "vitest";
import { canEditStudyText, libraryNotebookIds, sourceStudyBookId, studyShelves } from "./library";

describe("Study library", () => {
  it("lets Study's own text documents be edited, not notebook sources opened in Study", () => {
    const made = { id: "b1", format: "text", sourceId: "s1" } as const;
    expect(canEditStudyText(made)).toBe(true);
    expect(canEditStudyText({ ...made, attachedToNotebook: true })).toBe(true);
    expect(canEditStudyText({ ...made, id: sourceStudyBookId("s1"), attachedToNotebook: true })).toBe(false);
    expect(canEditStudyText({ ...made, format: "pdf" })).toBe(false);
  });

  it("groups documents by notebook in the order they come", () => {
    const shelves = studyShelves([
      { id: "a", notebookId: "n1" },
      { id: "b", notebookId: "n2" },
      { id: "c", notebookId: "n1" },
    ]);
    expect(shelves).toEqual([
      { notebookId: "n1", books: [{ id: "a", notebookId: "n1" }, { id: "c", notebookId: "n1" }] },
      { notebookId: "n2", books: [{ id: "b", notebookId: "n2" }] },
    ]);
  });

  it("finds notebooks made only to hold one Study document", () => {
    const counts = new Map([
      ["book", { sources: 1 }],
      ["grown", { sources: 3 }],
      ["subject", { sources: 1 }],
    ]);
    expect(
      libraryNotebookIds(
        [
          { notebookId: "book", sourceId: "s1" },
          { notebookId: "grown", sourceId: "s2" },
          { notebookId: "subject", sourceId: "s3", attachedToNotebook: true },
        ],
        counts,
      ),
    ).toEqual(new Set(["book"]));
  });
});
