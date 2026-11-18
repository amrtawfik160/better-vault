import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearFlashcardDraft,
  clearFlashcardDrafts,
  flashcardDraftKey,
  flashcardDrafts,
  readFlashcardDraft,
  restoreFlashcardSource,
  snapshotFlashcardSource,
  writeFlashcardDraft,
  type FlashcardDraftRecovery,
  type FlashcardSource,
} from "./flashcard-draft-recovery";

beforeEach(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() { return entries.size; },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  });
  vi.stubGlobal("window", new EventTarget());
});

afterEach(() => vi.unstubAllGlobals());

describe("flashcard draft recovery", () => {
  const origin = { kind: "note" as const, noteId: "proofs" };
  const source: FlashcardSource = {
    title: "Proofs",
    text: "Opening evidence",
    origin,
    tags: ["quorum"],
    parts: [
      { heading: "Opening", load: () => ({ origin, text: "Opening evidence" }) },
      { heading: "Recovery", load: () => ({ origin, text: "Later evidence" }) },
    ],
  };
  const draft: FlashcardDraftRecovery = {
    key: flashcardDraftKey("study", source),
    vaultId: "study",
    updatedAt: 1,
    version: "first",
    source: snapshotFlashcardSource(source),
    editor: {
      freeText: "",
      part: 1,
      count: 10,
      batches: [{
        part: 1,
        drafts: [{ id: "card-to-save", front: "Edited question", back: "Later evidence" }],
        excerpts: ["Later evidence"],
        origin,
      }],
    },
  };

  it("round trips a selected part, edited cards and the original source", () => {
    expect(writeFlashcardDraft(draft)).toBe(true);
    const saved = readFlashcardDraft(draft.key);
    expect(saved?.editor).toEqual(draft.editor);
    expect(restoreFlashcardSource(saved?.source)?.parts?.[1].load().text).toBe("Later evidence");
    expect(flashcardDrafts("study")).toHaveLength(1);
    expect(flashcardDrafts("private")).toHaveLength(0);
    clearFlashcardDrafts("private");
    expect(flashcardDrafts("study")).toHaveLength(1);
  });

  it("preserves a newer draft when an older editor tries to replace or discard it", () => {
    expect(writeFlashcardDraft(draft)).toBe(true);
    const newer = { ...draft, version: "newer", updatedAt: 2 };
    expect(writeFlashcardDraft(newer, draft.version)).toBe(true);
    expect(writeFlashcardDraft({ ...draft, version: "stale" }, draft.version)).toBe(false);
    clearFlashcardDraft(draft.key, draft.version);
    expect(readFlashcardDraft(draft.key)?.version).toBe(newer.version);
    clearFlashcardDraft(draft.key, newer.version);
    expect(readFlashcardDraft(draft.key)).toBeUndefined();
    expect(writeFlashcardDraft(draft, newer.version)).toBe(false);
  });
});
