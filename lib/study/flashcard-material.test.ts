import { describe, expect, it } from "vitest";
import { flashcardMaterialLimit } from "./ai";
import { flashcardDraftRanges } from "./flashcard-material";
import { noteFlashcardMaterial } from "./note-flashcards";

describe("flashcard draft parts", () => {
  it("covers an unbroken section without splitting a surrogate pair", () => {
    const text = "x".repeat(flashcardMaterialLimit - 1) + "🌙 Later evidence.";
    const parts = flashcardDraftRanges(text);
    expect(parts).toEqual([
      { offset: 0, length: flashcardMaterialLimit - 1 },
      { offset: flashcardMaterialLimit - 1, length: "🌙 Later evidence.".length },
    ]);
    expect(parts.map(({ offset, length }) => text.slice(offset, offset + length)).join("")).toBe(text);
    expect(flashcardDraftRanges("Short section")).toEqual([]);
  });

  it("continues past the draft limit while retaining note headings and citation offsets", () => {
    const note = { id: "note", title: "Replication", tags: [] };
    const title = "# Experiment\r\n\r\n";
    const body = "---\r\naliases: [Ledger]\r\n---\r\n" + title +
      "## Timeline\r\n\r\n" + "Existing proof. ".repeat(900) +
      "\r\n\r\n## Final check\r\n\r\nReplaying the epoch cannot replace an accepted write.";
    const { parts } = noteFlashcardMaterial(note, { body });
    expect(parts.map(({ heading }) => heading)).toEqual(["Timeline", "Timeline", "Final check"]);
    const last = parts.at(-1)!.load();
    const text = "## Final check\n\nReplaying the epoch cannot replace an accepted write.";
    expect(last.text).toBe(text);
    expect(last.passages).toEqual([{
      title: "Replication · Final check",
      text,
      origin: {
        kind: "note",
        noteId: note.id,
        passage: { offset: body.replaceAll("\r\n", "\n").indexOf(text), quote: text },
      },
    }]);
  });
});
