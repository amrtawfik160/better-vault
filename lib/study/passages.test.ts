import { describe, expect, it } from "vitest";
import { passagesFor } from "./passages";
import { findStudyExcerpt } from "./locators";
import { originHref } from "./links";
import type { StudyBook, StudyRecordOf, StudyThread } from "./records";
import { freshSchedule } from "./schedule";
import { studyTextEdit } from "./text-edits";

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
    const quizCard = { ...cards[1], quizChoices: ["A stale epoch", "A shared replica"] };
    expect(passagesFor(practice, { cards: [cards[0], quizCard] }, "Begin practice")[0].text).toEqual(
      "Question: Question second\n\nAnswer choices:\nA. A stale epoch\nB. A shared replica\n\nAnswer: Answer second",
    );
    const codeOption = "```ts\n" + "advanceTerm();\n".repeat(130) + "return record;\n```";
    const codeQuiz = { ...quizCard, quizChoices: ["A stale epoch", codeOption, "A shared replica"] };
    expect(passagesFor(practice, { cards: [codeQuiz] }, "Begin practice")[0].text).toContain(codeOption);
    expect(new URL(originHref(evidence[0].origin), "https://deeple.test").searchParams.get("card")).toBe("second");
    expect(passagesFor(practice, { cards }, "Review", "report").map(({ title }) => title)).toEqual(["Question first"]);
    expect(passagesFor(practice, { cards: [cards[2], cards[0]] }, "Continue").map(({ title }) => title)).toEqual(["Question first"]);
    const cardEvidence = new Map(
      cards.map(({ id }) => [
        id,
        [
          {
            origin: { kind: "note", noteId: id } satisfies import("./records").StudyOrigin,
            title: `Evidence ${id}`,
            text: `Source explanation ${id}`,
          },
        ],
      ]),
    );
    expect(
      passagesFor(practice, { cards, cardEvidence }, "Continue").map(({ title }) => title),
    ).toEqual(["Question second", "Evidence second"]);
    expect(
      passagesFor(practice, { cards, cardEvidence }, "Review", "report").map(({ title }) => title),
    ).toEqual(["Question first", "Evidence first"]);
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

  it("keeps the cited evidence through a chain of follow-ups and remaps it after a document edit", () => {
    const context = { ...thread, scope: "book" } satisfies StudyThread;
    const first = passagesFor(context, { book }, "Explain the Nyquist encirclements");
    const evidence = first.find(({ text }) => text.includes("critical point"));
    if (!evidence) throw new Error("Expected the Nyquist passage");
    const messages = [
      { role: "user", text: "Explain the Nyquist encirclements" },
      { role: "assistant", text: "Check the relationship to the critical point." },
      { role: "user", text: "Why does that matter?" },
      {
        role: "assistant",
        text: "It connects the contour to stability.",
        citations: [{ index: 7, title: evidence.title, origin: evidence.origin }],
      },
    ] satisfies StudyThread["messages"];
    const followUp = "Give me an example.";
    const unanchored = passagesFor(context, { book }, followUp);
    expect(unanchored.some(({ text }) => text.includes("critical point"))).toBe(false);
    const edited = "A new introduction to control systems.\n\n" + sectionText;
    const revised = {
      ...book,
      sections: [{ title: "Feedback", text: edited }],
      textEdits: [studyTextEdit(0, sectionText, edited)],
    };
    const continued = passagesFor(
      {
        ...context,
        messages,
        followUp: {
          threadId: "original",
          reportId: "report",
          index: 0,
          text: "Build a control loop with stable damping.",
        },
      },
      { book: revised },
      followUp,
    );
    expect(continued.find(({ previousCitations }) => previousCitations?.includes(7))).toMatchObject({
      text: expect.stringContaining("critical point"),
      origin: { kind: "book", revision: 1 },
    });
    expect(continued.length).toBeLessThanOrEqual(8);
    expect(continued.reduce((sum, passage) => sum + passage.text.length, 0)).toBeLessThanOrEqual(
      10_500,
    );
  });

  it("maps an explicit earlier citation only inside the current selection and clears it for a new topic", () => {
    const context = {
      ...thread,
      scope: "materials",
      noteIds: ["selected"],
      messages: [
        {
          role: "assistant",
          text: "Earlier explanation",
          citations: [
            { index: 2, title: "Private notes", origin: { kind: "note", noteId: "private" } },
            {
              index: 6,
              title: "Selected notes",
              origin: { kind: "note", noteId: "selected", heading: "Nyquist" },
            },
          ],
        },
      ],
    } satisfies StudyThread;
    const sources = {
      notes: [
        {
          id: "selected",
          title: "Selected notes",
          body: "Fourier decomposition.\n\n## Nyquist\nThe contour encircles the critical point.",
        },
        { id: "private", title: "Private notes", body: "UNSELECTED EVIDENCE" },
      ],
    };
    const followed = passagesFor(context, sources, "Can you expand on [6] and [2]?");
    expect(followed.filter(({ previousCitations }) => previousCitations)).toEqual([
      expect.objectContaining({
        previousCitations: [6],
        text: expect.stringContaining("critical point"),
      }),
    ]);
    expect(followed.map(({ text }) => text).join("\n")).not.toContain("UNSELECTED EVIDENCE");
    expect(
      passagesFor(context, sources, "Fourier").some(({ previousCitations }) => previousCitations),
    ).toBe(false);
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

  it("opens the first chapter of a notebook passage that spans chapters", () => {
    const sections = [
      { text: "Start here.\n\nA quorum needs a majority." },
      { text: "What changes when a replica fails?" },
    ];
    const excerpt = "A quorum needs a majority. What changes when a replica fails?";
    const anchor = findStudyExcerpt(sections, excerpt);
    expect(anchor).toMatchObject({ section: 0 });
    expect(anchor && sections[0].text.slice(anchor.offset, anchor.offset + anchor.length)).toBe(
      "A quorum needs a majority.",
    );
    expect(findStudyExcerpt([...sections, ...sections], excerpt)).toBeUndefined();
  });
});
