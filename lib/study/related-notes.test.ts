import { describe, expect, it } from "vitest";
import type { Note, Notebook, Vault } from "@/lib/db/types";
import { analyse } from "@/lib/notes/syntax";
import type { LinkWorld } from "@/lib/notes/resolve";
import { studyHref } from "./links";
import { notesAboutBook } from "./related-notes";

const note = (id: string, body: string, updatedAt = 0): Note => ({
  id,
  vaultId: "default",
  title: id,
  body,
  folder: "",
  ...analyse(body),
  createdAt: 0,
  updatedAt,
});
const vault: Vault = { id: "default", name: "Personal", order: 0, createdAt: 0, updatedAt: 0 };
const notebook = { id: "nb", title: "Reading", vaultId: "default" } as Notebook;

const world = (notes: Note[]): LinkWorld => ({
  notes,
  notebooks: [notebook],
  sources: [
    { id: "walden", notebookId: "nb", title: "Walden" },
    { id: "other", notebookId: "nb", title: "Meditations" },
  ],
  vaults: [vault],
  vaultName: (each) => each.name,
});

const book = { id: "book-1", sourceId: "walden" };

describe("notes about a Study book", () => {
  it("finds notes that link the book's source and notes saved from the book, newest first", () => {
    const saved = note("saved", `A thought\n\n[Open original](${studyHref("library", { book: "book-1", page: 2 })})`, 1);
    const linked = note("linked", "See [[src:Walden]] chapter 2", 5);
    const found = notesAboutBook(book, world([saved, linked]));
    expect(found.map(({ id }) => id)).toEqual(["linked", "saved"]);
  });

  it("ignores notes about other books and plain mentions", () => {
    const notes = [
      note("other", "[[src:Meditations]]"),
      note("mention", "I read Walden today"),
      note("elsewhere", `[Open](${studyHref("library", { book: "book-2" })})`),
    ];
    expect(notesAboutBook(book, world(notes))).toEqual([]);
  });
});
