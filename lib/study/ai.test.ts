import { describe, expect, it } from "vitest";
import { flashcardCitationsFor, flashcardMaterialLimit, studyConversationMaterial } from "./ai";
import type { StudyPassage } from "./passages";

const labels = { learner: "Learner", tutor: "Tutor" };

describe("studyConversationMaterial", () => {
  it("keeps answered questions in sequence and excludes a final unanswered question", () => {
    expect(
      studyConversationMaterial(
        [
          { role: "user", text: "How do epochs help?" },
          { role: "assistant", text: "They identify a leadership term." },
          { role: "user", text: "How are elections decided?" },
          { role: "assistant", text: "A quorum votes." },
          { role: "user", text: "My unconfirmed hypothesis" },
        ],
        labels,
      ).text,
    ).toBe(
      "Learner: How do epochs help?\n\nTutor: They identify a leadership term.\n\n" +
        "Learner: How are elections decided?\n\nTutor: A quorum votes.",
    );
  });

  it("keeps the latest explanation when the earliest turns would exceed the input limit", () => {
    const excerpt = studyConversationMaterial(
      [
        { role: "assistant", text: "Earlier text. ".repeat(flashcardMaterialLimit) },
        { role: "user", text: "Question ".repeat(flashcardMaterialLimit) },
        { role: "assistant", text: "Prioritize this recent answer." },
      ],
      labels,
    );
    expect(excerpt.text).toBe("Tutor: Prioritize this recent answer.");
  });

  it("carries citations for included answers and leaves the excluded exchanges out", () => {
    const cited = { kind: "note" as const, noteId: "included" };
    const excerpt = studyConversationMaterial(
      [
        {
          role: "assistant",
          text: "Older ".repeat(flashcardMaterialLimit),
          citations: [{ index: 1, title: "Old", origin: { kind: "note", noteId: "excluded" } }],
        },
        {
          role: "assistant",
          text: "Keep this answer.",
          citations: [{ index: 2, title: "Source", origin: cited }],
        },
      ],
      labels,
    );
    expect(excerpt).toEqual({ text: "Tutor: Keep this answer.", evidence: [cited] });
  });
});

it("assigns each card its own valid numbered citations", () => {
  const passages: StudyPassage[] = [
    { origin: { kind: "note", noteId: "a" }, title: "First", text: "First excerpt" },
    { origin: { kind: "note", noteId: "b" }, title: "Second", text: "Second excerpt" },
  ];
  expect(flashcardCitationsFor([3, 2, 2, -1, 0, 1.5], passages)).toEqual([
    { index: 2, title: "Second", origin: passages[1].origin },
  ]);
  expect(flashcardCitationsFor([], passages)).toEqual([]);
});
