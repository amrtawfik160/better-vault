import { describe, expect, it } from "vitest";
import { answerFlashcardMaterial } from "./study";
import type { ChatMessage } from "./types";

describe("notebook answer flashcards", () => {
  it("uses only completed flashcard visuals and removes inline references from the draft text", () => {
    const first = { front: "Why do the majorities overlap?", back: "They exceed the total size." };
    const second = { front: "What is an epoch?", back: "An increasing leadership term." };
    const failed = { front: "Invalid visual", back: "This should be omitted." };
    const message: ChatMessage = {
      id: "answer",
      role: "assistant",
      parts: [
        { type: "text", text: "Two majorities share at least one replica [1]." },
        {
          type: "tool-show_flashcards",
          toolCallId: "cards",
          state: "output-available",
          input: { title: "Recall", cards: [first, second, { ...first, back: "Duplicate" }] },
          output: { ok: true },
        },
        {
          type: "tool-show_flashcards",
          toolCallId: "failed",
          state: "output-available",
          input: { title: "Unavailable", cards: [failed, second] },
          output: { ok: false },
        },
        {
          type: "tool-show_flashcards",
          toolCallId: "writing",
          state: "input-streaming",
          input: { title: "Incomplete", cards: [failed, first] },
        },
      ],
    };
    expect(answerFlashcardMaterial(message)).toEqual({
      text: "Two majorities share at least one replica.",
      cards: [first, second],
    });
  });
});
