import { describe, expect, it } from "vitest";
import { originHref } from "./links";
import { locateCitedChunk } from "./locators";
import { passagesFor } from "./passages";
import type { StudyBook, StudyThread } from "./records";
import { locateStudyMark, resolveStudyRange, studyTextEdit } from "./text-edits";

const quote = "Distributed consensus requires intersecting quorums.";
const other = "Three replicas are a majority of a five-replica cluster.";

function textBook(...versions: string[]): StudyBook {
  return {
    id: "study-book",
    kind: "book",
    notebookId: "notebook",
    sourceId: "source",
    title: "Distributed systems",
    format: "text",
    section: 0,
    bookmarks: [],
    sections: [{ title: "Consensus", text: versions.at(-1) ?? "" }],
    textEdits: versions
      .slice(1)
      .map((version, index) => studyTextEdit(0, versions[index], version)),
    updatedAt: 0,
  };
}

describe("Study passages after editing", () => {
  it("keeps existing URLs and citations from different revisions on the same passage", () => {
    const original = `Original opening\n\n${quote}\n\nOriginal ending`;
    const intermediate = `بداية جديدة 📚\n\n${quote}\n\nOriginal ending`;
    const revised = `بداية جديدة 📚\n\n${other}\n\n${quote}\n\nRevised ending`;
    const book = textBook(original, intermediate, revised);
    const length = quote.length;
    const expected = { offset: revised.indexOf(quote), length };
    expect(resolveStudyRange(book, 0, { offset: original.indexOf(quote), length })).toEqual(
      expected,
    );
    expect(
      resolveStudyRange(book, 0, { offset: intermediate.indexOf(quote), length, revision: 1 }),
    ).toEqual(expected);

    const thread = {
      id: "thread",
      kind: "thread",
      scope: "chapter",
      section: 0,
      goal: "book",
      title: "Tutor",
      messages: [],
      updatedAt: 0,
    } satisfies StudyThread;
    const [passage] = passagesFor(thread, book, "Which replicas form a majority?");
    expect(new URL(originHref(passage.origin), "https://deeple.test").searchParams.get("rev")).toBe(
      "2",
    );
  });

  it("keeps original punctuation when an unchanged paragraph is moved", () => {
    const original = `${quote}\n\n${other}`;
    const revised = `${other}\n\n${quote}`;
    const book = textBook(original, revised);
    for (const text of [quote, other]) {
      expect(
        resolveStudyRange(book, 0, { offset: original.indexOf(text), length: text.length }),
      ).toEqual({ offset: revised.indexOf(text), length: text.length });
    }
  });

  it("does not place a removed highlight on a different occurrence of the same words", () => {
    const remaining = `Case two: ${quote}`;
    const original = `Case one: ${quote}\n\n${remaining}`;
    const book = textBook(original, remaining);
    expect(
      resolveStudyRange(book, 0, { offset: original.indexOf(quote), length: quote.length }),
    ).toBeUndefined();
    expect(locateStudyMark(book, { section: 0, offset: original.indexOf(quote), quote })).toBe(-1);
    expect(locateStudyMark(book, { section: 0, offset: original.lastIndexOf(quote), quote })).toBe(
      remaining.indexOf(quote),
    );
  });

  it("does not point a citation at replacement text", () => {
    const original = `Before. ${quote} After.`;
    const book = textBook(original, `Before. ${other} After.`);
    const range = { offset: original.indexOf(quote), length: quote.length };
    expect(resolveStudyRange(book, 0, range)).toBeUndefined();
    expect(resolveStudyRange(book, 1, range)).toBeUndefined();
  });
});

describe("Notebook citations after editing", () => {
  it("looks up the cited excerpt when chunks have been rebuilt", () => {
    const moved = { id: "source:1:2", text: `New context. ${quote}` };
    const chunks = [{ id: "source:1:0", text: other }, moved];
    expect(locateCitedChunk(chunks, "source:0", "Distributed   consensus requires")).toBe(moved);
    expect(locateCitedChunk(chunks, "source:0", undefined)).toBeUndefined();
    expect(
      locateCitedChunk([...chunks, { ...moved, id: "source:1:3" }], "source:0", quote),
    ).toBeUndefined();
  });
});
