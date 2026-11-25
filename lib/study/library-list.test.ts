import { describe, expect, it } from "vitest";
import type { SourceSummary } from "@/lib/db/types";
import { studyLibraryEntries } from "./library";
import {
  countBy,
  filterLibraryEntries,
  libraryEntryType,
  sortLibraryEntries,
} from "./library-list";
import type { StudyBook } from "./records";

const book = (
  id: string,
  notebookId: string,
  title: string,
  format: StudyBook["format"],
  lastReadAt?: number,
) =>
  ({
    id,
    notebookId,
    sourceId: id,
    title,
    format,
    sections: [{ title, text: "x" }],
    lastReadAt,
  }) as unknown as StudyBook;
const source = (
  id: string,
  notebookId: string,
  title: string,
  createdAt: number,
): SourceSummary => ({
  id,
  notebookId,
  title,
  kind: "url",
  createdAt,
  hasText: true,
  readable: true,
});

const entries = studyLibraryEntries(
  [
    book("a", "n1", "The Mom Test", "epub", 5),
    book("b", "n2", "Cell biology", "pdf", 9),
    book("c", "n2", "Notes", "text"),
  ],
  [source("s1", "n1", "Interviews", 1), source("s2", "n1", "Later page", 3)],
);
const titles = new Map([
  ["n1", "Customers"],
  ["n2", "Biology 101"],
]);
const find = (query: string, notebook = "all", type: "all" | "url" = "all") =>
  filterLibraryEntries(entries, { query, notebook, type }, titles).map((entry) => entry.id);

describe("library list", () => {
  it("sorts by last read, then the unopened ones newest first", () => {
    expect(sortLibraryEntries(entries).map((entry) => entry.id)).toEqual([
      "b",
      "a",
      "s2",
      "s1",
      "c",
    ]);
  });

  it("types books by format and sources by kind", () => {
    expect(entries.map(libraryEntryType)).toEqual(["epub", "pdf", "text", "url", "url"]);
  });

  it("filters by notebook, type and search over titles and notebook names", () => {
    expect(find("")).toHaveLength(5);
    expect(find("", "n2")).toEqual(["b", "c"]);
    expect(find("", "all", "url")).toEqual(["s1", "s2"]);
    expect(find("biology")).toEqual(["b", "c"]);
    expect(find("  MOM ")).toEqual(["a"]);
    expect(find("zzz")).toEqual([]);
  });

  it("counts documents per facet", () => {
    expect(countBy(entries, (entry) => entry.notebookId).get("n1")).toBe(3);
  });
});
