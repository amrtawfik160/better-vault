import { describe, expect, it } from "vitest";
import type { SourceSummary } from "@/lib/db/types";
import {
  canEditStudyText,
  libraryNotebookIds,
  notebookFollowsDocument,
  studyLibraryEntries,
  studyShelves,
} from "./library";

describe("Study library", () => {
  it("lets every text or Markdown document be edited, however it came in", () => {
    expect(canEditStudyText({ format: "text" })).toBe(true);
    expect(canEditStudyText({ format: "pdf" })).toBe(false);
    expect(canEditStudyText({ format: "epub" })).toBe(false);
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

  it("lists readable sources not started yet after the books, and marks books whose source was removed", () => {
    const source = (id: string, notebookId: string, readable = true): SourceSummary => ({
      id, notebookId, title: id, kind: "text", createdAt: 0, hasText: readable, readable,
    });
    const books = [
      { id: "b1", notebookId: "n1", sourceId: "s1", title: "Read" },
      { id: "b2", notebookId: "n1", sourceId: "gone", title: "Saved copy" },
    ];
    const sources = [source("s1", "n1"), source("s2", "n1"), source("s3", "n2"), source("empty", "n2", false)];
    expect(studyLibraryEntries(books, sources).map((entry) => [entry.kind, entry.id, entry.kind === "book" && entry.sourceRemoved]))
      .toEqual([["book", "b1", false], ["book", "b2", true], ["source", "s2", false], ["source", "s3", false]]);
    // While the sources load, books show without a "Source removed" mark.
    expect(studyLibraryEntries(books, undefined).map((entry) => entry.kind === "book" && entry.sourceRemoved))
      .toEqual([false, false]);
  });

  it("renames a notebook with its document only when it is named after its only source", () => {
    expect(notebookFollowsDocument({ title: "Raft" }, 0, "Raft")).toBe(true);
    expect(notebookFollowsDocument({ title: "Raft" }, 1, "Raft")).toBe(false);
    expect(notebookFollowsDocument({ title: "Distributed systems" }, 0, "Raft")).toBe(false);
    expect(notebookFollowsDocument(undefined, 0, "Raft")).toBe(false);
  });

  it("finds notebooks made to hold one Study document", () => {
    const counts = new Map([
      ["book", { sources: 1 }],
      ["grown", { sources: 3 }],
      ["subject", { sources: 1 }],
    ]);
    expect(
      libraryNotebookIds(
        [
          { notebookId: "book", title: "Quorums" },
          { notebookId: "grown", title: "Raft" },
          { notebookId: "subject", title: "Mitosis" },
        ],
        counts,
        [
          { id: "book", title: "Quorums" },
          { id: "grown", title: "Raft" },
          { id: "subject", title: "Cell biology" },
        ],
      ),
    ).toEqual(new Set(["book"]));
  });
});
