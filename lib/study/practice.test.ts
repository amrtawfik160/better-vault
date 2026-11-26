import { describe, expect, it } from "vitest";
import { notebookChatHref, originHref, studyHref, studyLocation } from "./links";
import { isPracticeThread, readerThreadHref, threadReaderBook } from "./practice";
import type { StudyBook, StudyThread } from "./records";
import { returnToTutor, tutorReturnState } from "./return-links";

const query = (href: string) => new URLSearchParams(href.split("?", 2)[1]);

const book: StudyBook = {
  id: "walden", kind: "book", notebookId: "nb-walden", sourceId: "src", title: "Walden", format: "text",
  sections: [{ title: "Economy", text: "Text" }, { title: "Solitude", text: "More" }], section: 0, bookmarks: [],
  updatedAt: 1,
};

function thread(change: Partial<StudyThread>): StudyThread {
  return {
    id: "t1", kind: "thread", title: "Walden", goal: "book", scope: "chapter", messages: [], updatedAt: 1,
    ...change,
  };
}

describe("Practice replaces the Tutor tab", () => {
  it("opens old Tutor links on Practice with the same thread, report and message", () => {
    expect(studyLocation(new URLSearchParams("view=study&tab=tutor"))).toEqual({ tab: "practice", filter: "all" });
    const old = new URLSearchParams("view=study&tab=tutor&thread=t1&report=1&reportId=r1&message=2");
    expect(studyLocation(old).tab).toBe("practice");
    expect(query(studyHref("tutor", { thread: "t1", fromToday: "1" })).toString()).toBe(
      "view=study&tab=practice&thread=t1&fromToday=1",
    );
  });

  it("links conversations and reports to Practice", () => {
    expect(query(originHref({ kind: "tutor", threadId: "t1", message: 3 })).toString()).toBe(
      "view=study&tab=practice&thread=t1&message=3",
    );
    expect(query(originHref({ kind: "report", threadId: "t1", reportId: "r1" })).get("tab")).toBe("practice");
  });

  it("returns to a conversation saved under the old or the new tab name", () => {
    for (const tab of ["tutor", "practice"]) {
      const path = `/?view=study&tab=${tab}&thread=t1`;
      expect(tutorReturnState({ studyTutorReturn: path })).toEqual({ studyTutorReturn: path });
      expect(returnToTutor(path, undefined, { message: 1 })).toEqual({
        studyTutorReturn: `/?view=study&tab=${tab}&thread=t1&message=1`,
      });
    }
    expect(tutorReturnState({ studyTutorReturn: "/?view=study&tab=practice" })).toBeUndefined();
  });
});

describe("practice sessions and book conversations", () => {
  it("keeps book questions and general chats out of practice", () => {
    expect(isPracticeThread(thread({ goal: "book" }))).toBe(false);
    expect(isPracticeThread(thread({ goal: "general" }))).toBe(false);
    expect(isPracticeThread(thread({ goal: "teach-back" }))).toBe(true);
    expect(isPracticeThread(thread({ goal: "language", scope: "general" }))).toBe(true);
  });

  it("opens a question thread about a document beside it in the reader", () => {
    const asking = thread({ bookId: book.id, section: 1 });
    expect(threadReaderBook(asking, [book])).toBe(book);
    expect(threadReaderBook(thread({ bookId: "removed" }), [book])).toBeUndefined();
    expect(threadReaderBook(thread({ goal: "teach-back", bookId: book.id }), [book])).toBeUndefined();
    expect(query(readerThreadHref(asking, book)).toString()).toBe(
      "view=study&tab=library&book=walden&page=1&reference=1&readerTutor=t1",
    );
  });

  it("links a book to its notebook's chat", () => {
    expect(notebookChatHref(book.notebookId)).toBe("/notebook/nb-walden?tab=chat");
  });
});
