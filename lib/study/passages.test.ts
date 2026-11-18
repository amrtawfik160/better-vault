import { describe, expect, it } from "vitest";
import { passagesFor } from "./passages";
import { findStudyExcerpt } from "./locators";
import type { StudyBook, StudyThread } from "./records";

const sectionText =
  "The system is stable in this discussion. Ordinary membership changes are common.\n\n".repeat(
    360,
  ) + "Nyquist stability is tested by counting encirclements of the critical point.";

const book = {
  id: "control",
  kind: "book",
  notebookId: "engineering",
  sourceId: "control-source",
  title: "Control systems",
  format: "text",
  section: 0,
  bookmarks: [],
  updatedAt: 0,
  sections: [{ title: "Feedback", text: sectionText }],
} satisfies StudyBook;

const thread = {
  id: "tutor",
  kind: "thread",
  updatedAt: 0,
  title: "Tutor",
  goal: "book",
  scope: "chapter",
  messages: [],
} satisfies StudyThread;

describe("Tutor grounding", () => {
  it("retrieves evidence near the end of a long chapter and links the exact source text", () => {
    const passages = passagesFor(thread, book, "Where does the Nyquist stability criterion apply?");
    const evidence = passages.find(({ text }) => text.includes("encirclements"));
    expect(evidence?.origin.kind).toBe("book");
    if (evidence?.origin.kind !== "book") throw new Error("Missing source evidence");
    const { offset, length } = evidence.origin;
    expect(offset).toBeGreaterThan(20_000);
    expect(sectionText.slice(offset, (offset ?? 0) + (length ?? 0))).toBe(evidence.text);
    expect(passages.length).toBeLessThanOrEqual(8);
  });

  it("uses the previous question for a short follow-up and stays within the requested notes", () => {
    const passages = passagesFor(
      {
        ...thread,
        scope: "notes",
        noteIds: ["reading-note"],
        messages: [{ role: "user", text: "How does the Nyquist criterion work?" }],
      },
      undefined,
      "Why does that matter?",
      [
        { id: "reading-note", title: "Stability notes", body: sectionText },
        { id: "other-note", title: "Other vault", body: "Nyquist criterion private notes" },
      ],
    );
    expect(passages.some(({ text }) => text.includes("critical point"))).toBe(true);
    expect(
      passages.every(({ origin }) => origin.kind === "note" && origin.noteId === "reading-note"),
    ).toBe(true);
  });

  it("prioritizes a matching page when short pages exceed the citation count", () => {
    const sections = Array.from({ length: 90 }, (_, index) => ({
      title: `Page ${index + 1}`,
      text: index === 89 ? "Capacitance increases with plate area." : `Generic note ${index}`,
    }));
    const passages = passagesFor(
      { ...thread, scope: "book" },
      { ...book, sections },
      "Compare capacitance and plate area",
    );
    expect(passages).toHaveLength(8);
    expect(passages.some(({ origin }) => origin.kind === "book" && origin.section === 89)).toBe(
      true,
    );
  });
});

describe("notebook citation handoff", () => {
  it("maps normalized citations to the exact offset and length in the reader", () => {
    const text = "   Background\n\nThe poles\n determine stability.\nThe end.";
    const anchor = findStudyExcerpt([{ text }], "The poles determine stability.");
    expect(anchor).toEqual({ section: 0, offset: 15, length: 31 });
    expect(anchor && text.slice(anchor.offset, anchor.offset + anchor.length)).toBe(
      "The poles\n determine stability.",
    );
  });

  it("leaves the reading position alone when the same excerpt has more than one match", () => {
    expect(
      findStudyExcerpt([{ text: "Same line" }, { text: "Same line" }], "Same line"),
    ).toBeUndefined();
  });
});
