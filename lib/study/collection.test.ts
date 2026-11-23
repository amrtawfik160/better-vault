import { describe, expect, it } from "vitest";
import { studyCollection, studyCollectionSearch } from "./collection";
import { originHref, studyCollectionHref, studyHref, studyLocation } from "./links";
import type { StudyBook, StudyRecord, StudyRecordOf } from "./records";
import { dailyReview, reviewCollection } from "./review-session";
import { freshSchedule } from "./schedule";

const now = 1_000_000;
const query = (href: string) => new URLSearchParams(href.split("?", 2)[1]);

const book: StudyBook = {
  id: "walden", kind: "book", notebookId: "nb-walden", sourceId: "src", title: "Walden", format: "text",
  sections: [{ title: "Economy", text: "Text" }], section: 0, bookmarks: [], updatedAt: 1,
};
const other: StudyBook = { ...book, id: "other", notebookId: "nb-other", title: "Other" };

function card(id: string, dueAt: number, change: Partial<StudyRecordOf<"card">> = {}): StudyRecordOf<"card"> {
  return {
    id, kind: "card", front: `Front ${id}`, back: "Back", tags: [], notebookId: book.notebookId,
    schedule: { ...freshSchedule(dueAt), dueAt }, updatedAt: 1, ...change,
  };
}

function highlight(id: string, dueAt: number, change: Partial<StudyRecordOf<"highlight">> = {}): StudyRecordOf<"highlight"> {
  return {
    id, kind: "highlight", bookId: book.id, notebookId: book.notebookId, section: 0, quote: `Quote ${id}`,
    offset: 0, color: "yellow", note: "", schedule: { ...freshSchedule(dueAt), dueAt }, updatedAt: 1, ...change,
  };
}

const word: StudyRecordOf<"word"> = {
  id: "deliberately", kind: "word", term: "deliberately", translation: "عن قصد", context: "to live deliberately",
  language: "Arabic", note: "", bookId: book.id, notebookId: book.notebookId, updatedAt: 1,
};
const wordCard = card("word-card-deliberately", now - 10, { origin: { kind: "word", wordId: word.id } });
const noteCard = card("note-card", now - 5, { origin: { kind: "note", noteId: "note" } });
const bookCard = card("book-card", now - 30, { origin: { kind: "book", bookId: book.id } });
const laterCard = card("later-card", now + 60_000);
const due = highlight("due-highlight", now - 20);
const green = highlight("green-highlight", now + 1, { color: "green" });
const elsewhere = highlight("elsewhere", now - 1, { bookId: other.id, notebookId: other.notebookId });
const rows: StudyRecord[] = [book, other, word, wordCard, noteCard, bookCard, laterCard, due, green, elsewhere];

describe("Collection replaces the Flashcards, Highlights and Vocabulary tabs", () => {
  it("opens old tab links on Collection with the matching filter and keeps their scope", () => {
    expect(studyLocation(query(studyHref("cards", { book: "walden" })))).toEqual({ tab: "collection", filter: "cards" });
    expect(studyLocation(new URLSearchParams("view=study&tab=highlights&book=walden"))).toEqual({
      tab: "collection",
      filter: "highlights",
    });
    expect(studyLocation(new URLSearchParams("tab=vocabulary&word=w"))).toEqual({ tab: "collection", filter: "words" });
    expect(query(studyHref("cards", { book: "walden", note: "n" })).get("book")).toBe("walden");
    expect(query(originHref({ kind: "word", wordId: "w" })).toString()).toBe("view=study&tab=collection&filter=words&word=w");
    expect(query(originHref({ kind: "card", cardId: "c" })).get("filter")).toBe("cards");
  });

  it("reads Collection's own filter and ignores it on other tabs", () => {
    expect(studyLocation(query(studyCollectionHref("all")))).toEqual({ tab: "collection", filter: "all" });
    expect(studyLocation(new URLSearchParams("tab=collection&filter=words"))).toEqual({ tab: "collection", filter: "words" });
    expect(studyLocation(new URLSearchParams("tab=collection&filter=nonsense"))).toEqual({ tab: "collection", filter: "all" });
    expect(studyLocation(new URLSearchParams("tab=review&filter=words"))).toEqual({ tab: "review", filter: "all" });
    expect(studyLocation(new URLSearchParams("tab=unknown"))).toEqual({ tab: "today", filter: "all" });
  });

  it("shows a word once, as the word, and scopes every kind to a book", () => {
    const all = studyCollection(rows, new URLSearchParams());
    expect(all.cards.map(({ id }) => id)).toEqual([noteCard.id, bookCard.id, laterCard.id]);
    expect(all.words).toEqual([word]);
    const walden = studyCollection(rows, new URLSearchParams({ book: book.id }));
    expect(walden.highlights).toEqual([due, green]);
    expect(walden.words).toEqual([word]);
    expect(studyCollection(rows, new URLSearchParams({ book: other.id })).words).toEqual([]);
  });

  it("keeps card-only scopes and colours to the kinds they can match", () => {
    const fromNote = studyCollection(rows, new URLSearchParams({ note: "note" }));
    expect(fromNote).toMatchObject({ cards: [noteCard], highlights: [], words: [] });
    const greens = studyCollection(rows, new URLSearchParams({ color: "green" }));
    expect(greens).toMatchObject({ cards: [], highlights: [green], words: [] });
    expect(studyCollection(rows, new URLSearchParams({ card: wordCard.id })).cards).toEqual([wordCard]);
    expect(studyCollection(rows, new URLSearchParams({ book: "missing" }))).toMatchObject({ cards: [], words: [] });
  });

  it("searches the text of every kind", () => {
    const { cards, highlights, words } = studyCollection(rows, new URLSearchParams());
    expect(studyCollectionSearch([...cards, ...highlights, ...words], "قصد")).toEqual([word]);
    expect(studyCollectionSearch(highlights, "  QUOTE green ")).toEqual([green]);
  });
});

describe("one daily review", () => {
  it("reviews flashcards, word cards and highlights together, ordered by due time", () => {
    const { due: queue, counts, next } = dailyReview(rows, now);
    expect(queue.map(({ id }) => id)).toEqual([bookCard.id, due.id, wordCard.id, noteCard.id, elsewhere.id]);
    expect(counts).toEqual({ highlight: 2, word: 1, card: 2 });
    expect(next).toBe(green.schedule.dueAt);
  });

  it("keeps filtered reviews to their kind and scope", () => {
    const ids = (params: string, selection?: string[]) =>
      reviewCollection(rows, new URLSearchParams(params), selection).map(({ id }) => id);
    expect(ids("kind=highlights&book=walden")).toEqual([due.id, green.id]);
    expect(ids("kind=vocabulary")).toEqual([wordCard.id]);
    expect(ids("kind=cards")).toEqual([wordCard.id, noteCard.id, bookCard.id, laterCard.id]);
    expect(ids("note=note")).toEqual([noteCard.id]);
    expect(ids("book=walden")).toEqual([wordCard.id, noteCard.id, bookCard.id, laterCard.id, due.id, green.id]);
    expect(ids("", [green.id, noteCard.id, word.id])).toEqual([green.id, noteCard.id]);
  });
});

describe("Collection of a Tutor conversation's flashcards", () => {
  it("shows only the cards made from that conversation, with no highlights or words", () => {
    const thread = {
      id: "t1", kind: "thread", goal: "book", scope: "book", title: "Chat", messages: [], updatedAt: 1,
    } as unknown as StudyRecord;
    const fromChat = card("chat-card", now, { origin: { kind: "tutor", threadId: "t1" } });
    const fromOther = card("other-chat", now, { origin: { kind: "tutor", threadId: "t2" } });
    const collected = studyCollection([...rows, thread, fromChat, fromOther], query(studyHref("cards", { thread: "t1", fromThread: "1" })));
    expect(collected.cards.map(({ id }) => id)).toEqual([fromChat.id]);
    expect(collected.highlights).toEqual([]);
    expect(collected.words).toEqual([]);
  });
});
