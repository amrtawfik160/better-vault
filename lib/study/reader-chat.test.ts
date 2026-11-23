import { describe, expect, it } from "vitest";
import {
  readerContext,
  readerReadLimit,
  readerSystemPrompt,
  runReaderTool,
} from "./reader-chat";

const sections = [
  { title: "Introduction", text: "Customers lie to be nice. Ask about their life, not your idea." },
  { title: "The Mom Test", text: "Talk about their life instead of your idea. Ask about specifics in the past." },
  { title: "Long", text: "x".repeat(readerReadLimit + 500) },
];

describe("reader tools", () => {
  it("reads a section, and a long one in parts", () => {
    expect(runReaderTool("read_section", { section: 2 }, sections)).toMatchObject({
      section: 2,
      title: "The Mom Test",
      more: false,
    });
    const first = runReaderTool("read_section", { section: 3 }, sections) as { to: number; more: boolean };
    expect(first).toMatchObject({ more: true, to: readerReadLimit });
    expect(runReaderTool("read_section", { section: 3, from: first.to }, sections)).toMatchObject({
      more: false,
      to: readerReadLimit + 500,
    });
    expect(runReaderTool("read_section", { section: 9 }, sections)).toHaveProperty("error");
  });

  it("finds the sections that mention a phrase, best first", () => {
    const { results } = runReaderTool("search_book", { query: "your idea" }, sections) as {
      results: { section: number; excerpt: string }[];
    };
    expect(results.map(({ section }) => section)).toEqual([1, 2]);
    expect(results[0].excerpt).toContain("your idea");
    expect(runReaderTool("search_book", { query: "pricing" }, sections)).toHaveProperty("note");
  });

  it("lists the contents and refuses bad input", () => {
    expect(runReaderTool("list_sections", {}, sections)).toMatchObject({
      total: 3,
      sections: [{ section: 1, title: "Introduction" }, { section: 2 }, { section: 3 }],
    });
    expect(runReaderTool("read_section", { section: 0 }, sections)).toHaveProperty("error");
  });
});

describe("reader context", () => {
  it("tells the model which part is on screen and gives its text", () => {
    const context = readerContext({ title: "The Mom Test", format: "epub", sections }, 1);
    expect(context).toMatchObject({ noun: "chapter", section: 2, sections: 3, more: false });
    const prompt = readerSystemPrompt(context, { tools: true, visuals: false });
    expect(prompt).toContain('has chapter 2, "The Mom Test" open');
    expect(prompt).toContain("Ask about specifics in the past.");
    expect(prompt).toContain("search_book");
    expect(readerSystemPrompt(context, { tools: false, visuals: false })).not.toContain("search_book");
  });

  it("says when the part on screen goes on past what was sent", () => {
    const context = readerContext({ title: "Doc", format: "pdf", sections }, 2);
    expect(context).toMatchObject({ noun: "page", more: true });
    expect(readerSystemPrompt(context, { tools: true, visuals: false })).toContain(
      `from=${readerReadLimit}`,
    );
  });
});
