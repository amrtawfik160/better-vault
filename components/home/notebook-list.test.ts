import { describe, expect, it } from "vitest";
import { documentSummary, searchNotebooks, sortItems, titlesByNotebook } from "./notebook-list";

const notebook = (id: string, title: string, updatedAt: number, pinned?: boolean) => ({
  id,
  title,
  updatedAt,
  ...(pinned ? { pinned } : {}),
});

describe("sortItems", () => {
  const items = [
    notebook("a", "Biology 101", 2),
    notebook("b", "spanish reading", 3),
    notebook("c", "The Mom Test", 1),
    notebook("d", "Archive", 0, true),
  ];

  it("puts pinned notebooks first, then the last changed", () => {
    expect(sortItems(items, "recent", (each) => each.title).map(({ id }) => id)).toEqual(["d", "b", "a", "c"]);
  });

  it("orders by name regardless of case, pinned first", () => {
    expect(sortItems(items, "name", (each) => each.title).map(({ id }) => id)).toEqual(["d", "a", "b", "c"]);
  });

  it("orders numbers in names by value", () => {
    const numbered = [notebook("x", "Week 10", 0), notebook("y", "Week 9", 0)];
    expect(sortItems(numbered, "name", (each) => each.title).map(({ id }) => id)).toEqual(["y", "x"]);
  });

  it("leaves the list it was given alone", () => {
    const copy = [...items];
    sortItems(items, "name", (each) => each.title);
    expect(items).toEqual(copy);
  });
});

describe("searchNotebooks", () => {
  const notebooks = [notebook("mom", "The Mom Test", 0), notebook("es", "Spanish reading", 0)];
  const titles = titlesByNotebook([
    { notebookId: "mom", title: "Interview script v2" },
    { notebookId: "es", title: "La sombra del viento, Carlos Ruiz Zafón" },
  ]);

  it("finds a notebook by its name or a document's title", () => {
    expect(searchNotebooks("mom", notebooks, titles).map(({ id }) => id)).toEqual(["mom"]);
    expect(searchNotebooks("interview", notebooks, titles).map(({ id }) => id)).toEqual(["mom"]);
  });

  it("ignores accents and case, and needs every word", () => {
    expect(searchNotebooks("ZAFON sombra", notebooks, titles).map(({ id }) => id)).toEqual(["es"]);
    expect(searchNotebooks("zafon interview", notebooks, titles)).toEqual([]);
  });

  it("finds everything with an empty search", () => {
    expect(searchNotebooks("  ", notebooks, titles)).toHaveLength(2);
  });
});

describe("documentSummary", () => {
  it("names the first two documents", () => {
    expect(documentSummary(["A", "B", "C"])).toBe("A, B");
    expect(documentSummary([])).toBe("");
  });
});
