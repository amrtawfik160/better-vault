// Test data for the Study book merge, shared by the pure tests and the
// store, migration and backup tests. Only tests import it.
import { expect } from "vitest";
import type { Notebook, Source, StoredBlob } from "@/lib/db/types";
import { studyDocumentDraftId } from "./document-drafts";
import { scanDraftId } from "./ocr-write";
import type { StudyBook, StudyRecord } from "./records";
import { freshSchedule } from "./schedule";
import { studyTextEdit } from "./text-edits";
import { studyImageId } from "./visual-card";

const before = "Alpha gamma. Delta epsilon.";
const after = "Alpha beta gamma. Delta epsilon zeta.";
const pdfTop = { kind: "pdf", top: 0 } as const;

/**
 * One source read by two books, as older versions could leave it: the book
 * imported with the source ("imported", whose text was edited since) and a
 * `source-s1` book opened from the notebook before that edit, which was read
 * last. Highlights, a card, a word, a thread, a practice session, a reading
 * session, drafts and a picture point at both. Beside them: a book with
 * `attachedToNotebook`, one without, and one whose source was deleted.
 */
export function duplicateBooksFixture() {
  const notebooks: Notebook[] = [
    { id: "n1", title: "Greek", createdAt: 1, updatedAt: 1 },
    { id: "n2", title: "Standalone", createdAt: 1, updatedAt: 1 },
  ];
  const source = (id: string, notebookId: string, text: string): Source => ({
    id, notebookId, title: id, kind: "text", text, charCount: text.length, selected: true, createdAt: 1,
  });
  const sources = [{ ...source("s1", "n1", after), studyRevision: 1 }, source("s2", "n2", "Kept."), source("s3", "n1", "Attached.")];
  const book = (id: string, notebookId: string, sourceId: string, text: string): StudyBook => ({
    id, kind: "book", notebookId, sourceId, title: "Greek", format: "text", sections: [{ title: "Greek", text }],
    section: 0, bookmarks: [], updatedAt: 100,
  });
  const highlight = (id: string, bookId: string, quote: string, offset: number, revision: number) => ({
    id, kind: "highlight", bookId, notebookId: "n1", section: 0, quote, offset, revision, color: "yellow",
    note: "", schedule: freshSchedule(0), updatedAt: 300,
  }) as const;
  const study: StudyRecord[] = [
    { ...book("imported", "n1", "s1", after), attachedToNotebook: true, textEdits: [studyTextEdit(0, before, after)] },
    {
      ...book("source-s1", "n1", "s1", before),
      attachedToNotebook: true,
      bookmarks: [0],
      bookmarkPlaces: [{ id: "p1", section: 0, offset: 13, quote: "Delta", revision: 0 }],
      lastReadAt: 500,
      readingPlace: { section: 0, surface: "text", progress: 0.5, anchor: { offset: 13, quote: "Delta epsilon", revision: 0 } },
      readingAppearance: { textSize: 20 },
      updatedAt: 500,
    },
    book("standalone", "n2", "s2", "Kept."),
    { ...book("attached", "n1", "s3", "Attached."), attachedToNotebook: true },
    { ...book("orphan", "n1", "gone", "Saved copy."), attachedToNotebook: true },
    highlight("mark-kept", "imported", "Alpha", 0, 1),
    highlight("mark-dup", "source-s1", "Delta", 13, 0),
    {
      id: "card", kind: "card", front: "Which letter?", back: "Delta", tags: [], notebookId: "n1",
      origin: { kind: "book", bookId: "source-s1", section: 0, offset: 13, length: 5, revision: 0 },
      citations: [{ index: 1, title: "Greek", bookId: "source-s1", section: 0 }],
      schedule: freshSchedule(0), updatedAt: 310,
    },
    {
      id: "word", kind: "word", term: "delta", translation: "", context: "Delta epsilon.", language: "English",
      note: "", notebookId: "n1", bookId: "source-s1", origin: { kind: "book", bookId: "source-s1", section: 0 },
      examples: [{ context: "Delta.", origin: { kind: "book", bookId: "source-s1", section: 0 } }], updatedAt: 320,
    },
    {
      id: "thread", kind: "thread", title: "Delta", goal: "book", scope: "passage", bookId: "source-s1", section: 0,
      quote: "Delta", offset: 13, revision: 0, bookIds: ["imported", "source-s1"],
      messages: [{ role: "assistant", text: "It is a letter [1].", citations: [
        { index: 1, title: "Greek", origin: { kind: "book", bookId: "source-s1", section: 0 } },
      ] }],
      report: { summary: "", corrections: [], nextSteps: [], practiceContext: { goal: "book", scope: "book", bookId: "source-s1" } },
      updatedAt: 330,
    },
    {
      id: "practice", kind: "practice", title: "Letters", createdAt: 340, audience: "friend",
      material: { origins: [{ kind: "book", bookId: "source-s1" }] },
      passages: [{ title: "Greek", text: "Delta", origin: { kind: "book", bookId: "source-s1", section: 0, offset: 13, length: 5, revision: 0 } }],
      types: ["write"], questions: [], updatedAt: 340,
    },
    {
      id: "reading", kind: "session", activity: "reading", seconds: 60, count: 1, notebookId: "n1",
      origin: { kind: "book", bookId: "source-s1", section: 0 }, updatedAt: 200,
    },
    {
      id: studyDocumentDraftId({ bookId: "source-s1", section: 0 }), kind: "document-draft", bookId: "source-s1",
      notebookId: "n1", version: "v1", snapshot: null, updatedAt: 1,
    },
    { id: scanDraftId("source-s1"), kind: "ocr-draft", bookId: "source-s1", notebookId: "n1", fileId: "file", version: "v1", pages: [], updatedAt: 1 },
  ];
  const blobs: StoredBlob[] = [
    { id: studyImageId("source-s1", 0, pdfTop), notebookId: "n1", sourceId: "s1", mime: "image/png", data: Uint8Array.of(1), createdAt: 1 },
  ];
  return { notebooks, sources, study, blobs };
}

/** What the fixture looks like once merged, in any store. */
export function expectMergedFixture(rows: readonly StudyRecord[], blobIds: readonly string[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const fixture = duplicateBooksFixture();
  // Only the merged-away book is gone; one draft of each kind moved to the kept id.
  expect(rows.map(({ id }) => id).sort()).toEqual(
    fixture.study
      .map(({ id }) => id.replace("source-s1", "imported"))
      .filter((id) => id !== "imported" || fixture.study.some((row) => row.id === id))
      .filter((id, index, ids) => ids.indexOf(id) === index)
      .sort(),
  );
  expect(rows).toHaveLength(fixture.study.length - 1);
  expect(byId.has("source-s1")).toBe(false);
  expect(rows.filter((row) => row.kind === "book").map(({ id }) => id).sort()).toEqual(["attached", "imported", "orphan", "standalone"]);
  for (const row of rows) expect(row).not.toHaveProperty("attachedToNotebook");

  const kept = fixture.study[0] as StudyBook;
  expect(byId.get("imported")).toEqual({
    id: "imported", kind: "book", notebookId: "n1", sourceId: "s1", title: "Greek", format: "text",
    sections: kept.sections, textEdits: kept.textEdits,
    section: 0, bookmarks: [0],
    bookmarkPlaces: [{ id: "p1", section: 0, offset: 18, quote: "Delta", revision: 1 }],
    lastReadAt: 500,
    readingPlace: { section: 0, surface: "text", progress: 0.5, anchor: { offset: 18, quote: "Delta epsilon", revision: 1 } },
    readingAppearance: { textSize: 20 },
    mergedIds: ["source-s1"],
    updatedAt: 500,
  });
  expect(byId.get("mark-kept")).toEqual(fixture.study.find(({ id }) => id === "mark-kept"));
  expect(byId.get("mark-dup")).toMatchObject({ bookId: "imported", quote: "Delta", offset: 18, revision: 1 });
  expect(byId.get("card")).toMatchObject({
    origin: { kind: "book", bookId: "imported", section: 0, offset: 18, length: 5, revision: 1 },
    citations: [{ index: 1, title: "Greek", bookId: "imported", section: 0 }],
    schedule: freshSchedule(0),
  });
  expect(byId.get("word")).toMatchObject({
    bookId: "imported",
    origin: { kind: "book", bookId: "imported", section: 0 },
    examples: [{ origin: { kind: "book", bookId: "imported" } }],
  });
  expect(byId.get("thread")).toMatchObject({
    bookId: "imported", offset: 18, revision: 1, quote: "Delta", bookIds: ["imported"],
    messages: [{ citations: [{ origin: { kind: "book", bookId: "imported", section: 0 } }] }],
    report: { practiceContext: { bookId: "imported" } },
  });
  expect(byId.get("practice")).toMatchObject({
    material: { origins: [{ kind: "book", bookId: "imported" }] },
    passages: [{ origin: { kind: "book", bookId: "imported", offset: 18, length: 5, revision: 1 } }],
  });
  expect(byId.get("reading")).toMatchObject({ origin: { kind: "book", bookId: "imported", section: 0 } });
  expect(byId.get(studyDocumentDraftId({ bookId: "imported", section: 0 }))).toMatchObject({ kind: "document-draft", bookId: "imported" });
  expect(byId.get(scanDraftId("imported"))).toMatchObject({ kind: "ocr-draft", bookId: "imported" });
  expect(byId.has(studyDocumentDraftId({ bookId: "source-s1", section: 0 }))).toBe(false);
  expect(byId.has(scanDraftId("source-s1"))).toBe(false);
  expect([...blobIds]).toEqual([studyImageId("imported", 0, pdfTop)]);
}
