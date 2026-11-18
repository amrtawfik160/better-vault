import { describe, expect, it } from "vitest";
import { flashcardMaterialLimit, studyConversationExcerpt } from "./ai";

const labels = { learner: "Learner", tutor: "Tutor" };

describe("studyConversationExcerpt", () => {
  it("keeps answered questions in sequence and excludes a final unanswered question", () => {
    expect(
      studyConversationExcerpt(
        [
          { role: "user", text: "How do epochs help?" },
          { role: "assistant", text: "They identify a leadership term." },
          { role: "user", text: "How are elections decided?" },
          { role: "assistant", text: "A quorum votes." },
          { role: "user", text: "My unconfirmed hypothesis" },
        ],
        labels,
      ),
    ).toBe(
      "Learner: How do epochs help?\n\nTutor: They identify a leadership term.\n\n" +
        "Learner: How are elections decided?\n\nTutor: A quorum votes.",
    );
  });

  it("keeps the latest explanation when the earliest turns would exceed the input limit", () => {
    const excerpt = studyConversationExcerpt(
      [
        { role: "assistant", text: "Earlier text. ".repeat(flashcardMaterialLimit) },
        { role: "user", text: "Question ".repeat(flashcardMaterialLimit) },
        { role: "assistant", text: "Prioritize this recent answer." },
      ],
      labels,
    );
    expect(excerpt).toBe("Tutor: Prioritize this recent answer.");
  });
});
