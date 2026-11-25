import { describe, expect, it } from "vitest";
import {
  firstOpenStrip,
  leftOffLineStart,
  practiceEntry,
  practiceEntryQuery,
  readerCompanionLayout,
  readerDefaultExercise,
  readerPart,
  readerPracticeResults,
} from "./reader-companion";
import type { StudyOrigin, StudyPractice } from "./records";

const session = (id: string, mode: "teach" | "questions", origins: StudyOrigin[], updatedAt = 1) =>
  ({ id, kind: "practice", mode, updatedAt, material: { origins }, questions: [] }) as unknown as StudyPractice;

describe("readerDefaultExercise", () => {
  it("explains it back the first time", () => {
    expect(readerDefaultExercise([], "a", 2)).toBe("teach");
  });

  it("asks questions once this chapter, or the whole document, was explained back", () => {
    expect(readerDefaultExercise([session("1", "teach", [{ kind: "book", bookId: "a", section: 2 }])], "a", 2)).toBe("questions");
    expect(readerDefaultExercise([session("1", "teach", [{ kind: "book", bookId: "a" }])], "a", 2)).toBe("questions");
  });

  it("ignores other chapters, other documents and question sessions", () => {
    const sessions = [
      session("1", "teach", [{ kind: "book", bookId: "a", section: 1 }]),
      session("2", "teach", [{ kind: "book", bookId: "b", section: 2 }]),
      session("3", "questions", [{ kind: "book", bookId: "a", section: 2 }]),
    ];
    expect(readerDefaultExercise(sessions, "a", 2)).toBe("teach");
  });
});

describe("readerPracticeResults", () => {
  it("keeps this document's sessions, newest first", () => {
    const sessions = [
      session("old", "teach", [{ kind: "book", bookId: "a", section: 0 }], 1),
      session("other", "teach", [{ kind: "book", bookId: "b" }], 5),
      session("notes", "questions", [{ kind: "note", noteId: "n" }], 6),
      session("new", "questions", [{ kind: "card", cardId: "c" }, { kind: "book", bookId: "a" }], 3),
    ];
    expect(readerPracticeResults(sessions, "a").map(({ id }) => id)).toEqual(["new", "old"]);
  });

  it("keeps a few", () => {
    const sessions = Array.from({ length: 5 }, (_, at) => session(String(at), "teach", [{ kind: "book", bookId: "a" }], at));
    expect(readerPracticeResults(sessions, "a", 2).map(({ id }) => id)).toEqual(["4", "3"]);
  });
});

describe("practiceEntry", () => {
  it("reads a written exercise with its material", () => {
    expect(practiceEntry(new URLSearchParams("exercise=teach&book=a&section=3"))).toEqual({
      exercise: "teach",
      bookId: "a",
      section: 3,
    });
    expect(practiceEntry(new URLSearchParams("exercise=questions&book=a"))).toEqual({ exercise: "questions", bookId: "a" });
  });

  it("keeps only the exercise for role-play, and drops a bad section", () => {
    expect(practiceEntry(new URLSearchParams("exercise=roleplay&book=a&section=1"))).toEqual({ exercise: "roleplay" });
    expect(practiceEntry(new URLSearchParams("exercise=teach&book=a&section=-1"))).toEqual({ exercise: "teach", bookId: "a" });
  });

  it("ignores links without a known exercise", () => {
    expect(practiceEntry(new URLSearchParams("book=a"))).toBeNull();
    expect(practiceEntry(new URLSearchParams("exercise=quiz&book=a"))).toBeNull();
  });

  it("reads back what practiceEntryQuery writes", () => {
    for (const entry of [
      { exercise: "teach", bookId: "a", section: 0 },
      { exercise: "questions", bookId: "a" },
      { exercise: "roleplay" },
    ] as const) {
      const query = new URLSearchParams(
        Object.entries(practiceEntryQuery(entry)).flatMap(([key, value]) => (value === undefined ? [] : [[key, value]])),
      );
      expect(practiceEntry(query)).toEqual(entry);
    }
  });
});

describe("readerPart", () => {
  it("names a PDF's pages, other documents' chapters, and a one-part document", () => {
    expect(readerPart({ format: "pdf", sections: [1, 2, 3] }, 1)).toEqual({ kind: "page", number: 2 });
    expect(readerPart({ format: "epub", sections: [1, 2] }, 5)).toEqual({ kind: "chapter", number: 2 });
    expect(readerPart({ format: "text", sections: [1] }, 0)).toEqual({ kind: "document" });
  });
});

describe("readerCompanionLayout", () => {
  it("follows the breakpoints", () => {
    expect(readerCompanionLayout(true, true)).toBe("column");
    expect(readerCompanionLayout(false, true)).toBe("overlay");
    expect(readerCompanionLayout(false, false)).toBe("sheet");
  });
});

describe("firstOpenStrip", () => {
  it("shows once for a new document and remembers it", () => {
    expect(firstOpenStrip(null, false)).toEqual({ show: true, remember: "pending" });
    expect(firstOpenStrip("pending", true)).toEqual({ show: true });
    expect(firstOpenStrip("done", false)).toEqual({ show: false });
  });

  it("stays away from documents read before", () => {
    expect(firstOpenStrip(null, true)).toEqual({ show: false });
  });
});

describe("leftOffLineStart", () => {
  const text = "First line.\nSecond line goes on.\nThird.";

  it("marks the start of the line that holds the position", () => {
    expect(leftOffLineStart(text, 15)).toBe(12);
    expect(leftOffLineStart(text, 12)).toBe(12);
    expect(leftOffLineStart(text, text.length - 2)).toBe(text.indexOf("Third"));
  });

  it("marks nothing on the first line or outside the text", () => {
    expect(leftOffLineStart(text, 4)).toBeUndefined();
    expect(leftOffLineStart(text, 0)).toBeUndefined();
    expect(leftOffLineStart(text, text.length + 3)).toBeUndefined();
  });
});
