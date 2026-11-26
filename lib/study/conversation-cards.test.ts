import { describe, expect, it } from "vitest";
import { tutorCardsScope } from "./links";
import type { StudyOrigin, StudyRecordOf } from "./records";
import { returnFromTutorCards } from "./return-links";
import { studyCardsInScope } from "./review-session";
import { freshSchedule } from "./schedule";

function card(id: string, origin?: StudyOrigin): StudyRecordOf<"card"> {
  return {
    id,
    kind: "card",
    front: "Question",
    back: "Answer",
    tags: [],
    origin,
    schedule: freshSchedule(1),
    updatedAt: 1,
  };
}

describe("flashcards made from a Tutor conversation", () => {
  const cards = [
    card("whole", { kind: "tutor", threadId: "t1" }),
    card("answer", { kind: "tutor", threadId: "t1", message: 3 }),
    card("other", { kind: "tutor", threadId: "t2" }),
    card("report", { kind: "report", threadId: "t1", reportId: "r1" }),
    card("plain"),
  ];

  it("keeps the cards drafted from the conversation and from its answers", () => {
    const params = new URLSearchParams(tutorCardsScope({ kind: "tutor", threadId: "t1" }));
    expect(params.toString()).toBe("thread=t1&fromThread=1");
    expect(studyCardsInScope(cards, params, undefined, "t1").map(({ id }) => id)).toEqual([
      "whole",
      "answer",
    ]);
  });

  it("returns to the conversation from its cards", () => {
    expect(
      returnFromTutorCards("/?view=study&tab=tutor&thread=t1&message=2", undefined, {
        kind: "tutor",
        threadId: "t1",
      }),
    ).toEqual({ studyTutorReturn: "/?view=study&tab=tutor&thread=t1&message=2" });
  });
});
