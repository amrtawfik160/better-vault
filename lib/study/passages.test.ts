import { describe, expect, it } from "vitest";
import { passagesFor } from "./passages";
import { findStudyExcerpt } from "./locators";
import { originHref } from "./links";
import type { StudyBook, StudyRecordOf, StudyThread } from "./records";
import { freshSchedule } from "./schedule";

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
  it("cites selected highlights at their saved mark and keeps notes separate from source text", () => {
    const quote = "A quorum decides what a majority accepts.";
    const prefix = "This paragraph was added later.\n\n";
    const highlightedBook: StudyBook = { ...book, sections: [{ title: "Elections", text: prefix + quote }] };
    const highlight: StudyRecordOf<"highlight"> = {
      id: "quorum", kind: "highlight", bookId: book.id, section: 0, offset: 0, quote,
      color: "yellow", note: "Connect this to the acceptance rule.", schedule: freshSchedule(0), updatedAt: 0,
    };
    const context: StudyThread = { ...thread, scope: "materials", highlightIds: [highlight.id] };
    const passages = passagesFor(context, { highlights: [
      { highlight, book: highlightedBook },
      { highlight: { ...highlight, id: "unselected", note: "UNSELECTED" }, book: highlightedBook },
    ] }, "Explain the connection to the acceptance rule");
    expect(passages.map(({ text }) => text)).toEqual([quote, "Learner annotation:\nConnect this to the acceptance rule."]);
    expect(passages.map(({ origin }) => origin)).toEqual(Array.from({ length: 2 }, () => ({
      kind: "book", bookId: book.id, section: 0, highlightId: highlight.id,
      offset: prefix.length, length: quote.length, revision: 0,
    })));
    const stale = passagesFor(context, { highlights: [
      { highlight, book: { ...highlightedBook, sections: [{ title: "Elections", text: "Replacement" }] } },
    ] }, "Summarize");
    expect(stale[0].origin).toEqual({ kind: "book", bookId: book.id, section: 0, highlightId: highlight.id });
  });

  it("sends just the active card for practice and only discussed cards for reports", () => {
    const cards = ["first", "second", "third", "outside"].map((id): StudyRecordOf<"card"> => ({
      id, kind: "card", front: `Question ${id}`, back: `Answer ${id}`, tags: [],
      updatedAt: 0, schedule: freshSchedule(0),
    }));
    const practice: StudyThread = {
      ...thread, scope: "cards", practiceCardId: "second", cardIds: ["first", "second", "third"],
      messages: [
        { role: "user", text: "Start", practiceCardId: "first" },
        { role: "assistant", text: "Explain the first concept", practiceCardId: "first" },
        { role: "user", text: "Old practice in another set", practiceCardId: "outside" },
      ],
    };
    const evidence = passagesFor(practice, { cards }, "Begin practice");
    expect(evidence).toEqual([{
      origin: { kind: "card", cardId: "second" }, title: "Question second",
      text: "Question: Question second\n\nAnswer: Answer second",
    }]);
    expect(new URL(originHref(evidence[0].origin), "https://deeple.test").searchParams.get("card")).toBe("second");
    expect(passagesFor(practice, { cards }, "Review", "report").map(({ title }) => title)).toEqual(["Question first"]);
    expect(passagesFor(practice, { cards: [cards[2], cards[0]] }, "Continue").map(({ title }) => title)).toEqual(["Question first"]);
  });

  it("retrieves evidence near the end of a long chapter and links the exact source text", () => {
    const passages = passagesFor(
      thread,
      { book },
      "Where does the Nyquist stability criterion apply?",
    );
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
      {
        notes: [
          { id: "reading-note", title: "Stability notes", body: sectionText },
          { id: "other-note", title: "Other vault", body: "Nyquist criterion private notes" },
        ],
      },
      "Why does that matter?",
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
      { book: { ...book, sections } },
      "Compare capacitance and plate area",
    );
    expect(passages).toHaveLength(8);
    expect(passages.some(({ origin }) => origin.kind === "book" && origin.section === 89)).toBe(
      true,
    );
  });

  it("reserves evidence for each selected document and note before a long source fills the budget", () => {
    const longBook = {
      ...book,
      sections: Array.from({ length: 32 }, (_, index) => ({
        title: `Candidate ${index}`,
        text: `Nyquist loop gain and feedback ${index}.`,
      })),
    };
    const shortBook = {
      ...book,
      id: "handbook",
      title: "Controller handbook",
      sections: [
        { title: "Measurement", text: "Measure the transfer function against the modeled loop." },
      ],
    };
    const material = {
      ...thread,
      scope: "materials",
      bookIds: [longBook.id, shortBook.id],
      noteIds: ["lab-notes"],
    } satisfies StudyThread;
    const passages = passagesFor(
      material,
      {
        books: [
          longBook,
          shortBook,
          {
            ...shortBook,
            id: "unselected",
            sections: [{ title: "Private", text: "UNSELECTED DOCUMENT" }],
          },
        ],
        notes: [
          {
            id: "lab-notes",
            title: "Lab notes",
            body: "Raw measurements.\n\n## Open-loop measurement\nNyquist results depend on the measured gain.",
          },
          { id: "unselected-note", title: "Other notes", body: "UNSELECTED NOTE" },
        ],
      },
      "Nyquist loop gain feedback measurement",
    );
    expect(passages).toHaveLength(8);
    expect(
      passages.some(({ origin }) => origin.kind === "book" && origin.bookId === longBook.id),
    ).toBe(true);
    expect(
      passages.some(
        ({ origin }) =>
          origin.kind === "book" && origin.bookId === shortBook.id && origin.offset === 0,
      ),
    ).toBe(true);
    const note = passages.find(({ text }) => text.includes("measured gain"));
    expect(note?.origin).toEqual({
      kind: "note",
      noteId: "lab-notes",
      heading: "Open-loop measurement",
    });
    expect(
      note && new URL(originHref(note.origin), "https://deeple.test").searchParams.get("heading"),
    ).toBe("Open-loop measurement");
    expect(passages.map(({ text }) => text).join("\n")).not.toContain("UNSELECTED");
  });

  it("uses the note itself when a heading appears more than once", () => {
    const passages = passagesFor(
      { ...thread, scope: "notes", noteIds: ["n"] },
      {
        notes: [
          {
            id: "n",
            title: "Experiments",
            body: "## Experiment\nFirst data\n\n## experiment\nSecond data",
          },
        ],
      },
      "Compare both experiments",
    );
    expect(passages.map(({ origin }) => origin)).toEqual([
      { kind: "note", noteId: "n" },
      { kind: "note", noteId: "n" },
    ]);
  });

  it("cites an original notebook chunk and deduplicates material already selected in Study", () => {
    const material = {
      ...thread,
      scope: "materials",
      bookIds: [book.id],
      sourceIds: ["method", book.sourceId],
    } satisfies StudyThread;
    const passages = passagesFor(
      material,
      {
        books: [book],
        notebookSources: [
          {
            id: "method",
            notebookId: "research",
            title: "Method",
            chunks: [{ id: "method:17", text: "Vary the input to measure the frequency response." }],
          },
          {
            id: book.sourceId,
            notebookId: book.notebookId,
            title: book.title,
            chunks: [{ id: "duplicate:0", text: "ALREADY IN STUDY" }],
          },
          {
            id: "unselected",
            notebookId: "research",
            title: "Other method",
            chunks: [{ id: "unselected:0", text: "NOT SELECTED" }],
          },
        ],
      },
      "Compare Nyquist and the frequency response measurement",
    );
    const citation = passages.find(({ title }) => title === "Method");
    expect(citation?.text).toBe("Vary the input to measure the frequency response.");
    const url = citation && new URL(originHref(citation.origin), "https://deeple.test");
    expect(url?.pathname).toBe("/notebook/research");
    expect(url?.searchParams.get("source")).toBe("method");
    expect(url?.searchParams.get("passage")).toBe("method:17");
    expect(passages.some(({ text }) => /ALREADY IN STUDY|NOT SELECTED/.test(text))).toBe(false);
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
