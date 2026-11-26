import { describe, expect, it } from "vitest";
import { studyReadingProgress } from "./reading-progress";
import type { StudyBook } from "./records";
import { studyTextEdit } from "./text-edits";

const book = (format: StudyBook["format"], ...texts: string[]): StudyBook => ({
  id: "book",
  kind: "book",
  notebookId: "notebook",
  sourceId: "source",
  title: "Distributed systems",
  format,
  sections: texts.map((text, index) => ({ title: `Section ${index + 1}`, text })),
  section: 0,
  bookmarks: [],
  updatedAt: 0,
});

describe("reading progress", () => {
  it("uses the saved position inside a one-section document", () => {
    const notes = book("text", "x".repeat(100));
    expect(studyReadingProgress(notes)).toBe(0);
    const readingPlace = { section: 0, surface: "text", progress: 0.4 } as const;
    expect(studyReadingProgress({ ...notes, readingPlace })).toBe(0.4);
    expect(
      studyReadingProgress({ ...notes, readingPlace: { ...readingPlace, endRevision: 0 } }),
    ).toBe(1);
  });

  it("uses equally weighted PDF pages even when text extraction yields an empty page", () => {
    const pdf = book("pdf", "Text on page one", "");
    const readingPlace = { section: 0, surface: "layout", progress: 0.7 } as const;
    expect(studyReadingProgress({ ...pdf, section: 1, readingPlace })).toBe(0.5);
    expect(
      studyReadingProgress({ ...pdf, section: 1, readingPlace: { ...readingPlace, section: 1 } }),
    ).toBe(0.85);
  });

  it("weights EPUB chapters by length and resolves the latest text anchor", () => {
    const chapter = `${"z".repeat(45)} Quorum math ${"x".repeat(44)}`;
    const epub = book("epub", "x".repeat(20), chapter);
    expect(studyReadingProgress({ ...epub, section: 1 })).toBeCloseTo(20 / (20 + chapter.length));
    const offset = chapter.indexOf("Quorum math");
    expect(
      studyReadingProgress({
        ...epub,
        section: 1,
        readingPlace: {
          section: 1,
          surface: "layout",
          progress: 0.3,
          anchor: { offset, quote: "Quorum math", revision: 0 },
        },
      }),
    ).toBeCloseTo((20 + offset) / (20 + chapter.length));
  });

  it("does not retain an end marker when the document is extended", () => {
    const original = "An opening with detailed notes.\n\nQuorum math and its limitations.";
    const revised = `${original}\n\nMore examples and exercises.`;
    const notes = book("text", revised);
    const quote = "Quorum math and its limitations.";
    const offset = original.indexOf(quote);
    const readingPlace = {
      section: 0,
      surface: "text",
      progress: 0.9,
      endRevision: 0,
      anchor: { quote, offset, revision: 0 },
    } as const;
    expect(
      studyReadingProgress({
        ...notes,
        readingPlace,
        textEdits: [studyTextEdit(0, original, revised)],
      }),
    ).toBeCloseTo(offset / revised.length);
  });
});
