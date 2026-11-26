import { describe, expect, it } from "vitest";
import { studyActivityGroups } from "./activity";
import type { StudyRecordOf } from "./records";

describe("studyActivityGroups", () => {
  it("merges a visit, a conversation, and a review independently and keeps their latest records", () => {
    const event = { kind: "session", count: 1, seconds: 30 } as const;
    const sessions: StudyRecordOf<"session">[] = [
      {
        ...event,
        id: "chapter-two",
        updatedAt: 50,
        activity: "reading",
        activitySessionId: "visit",
      },
      { ...event, id: "dictation", updatedAt: 60, activity: "speaking" },
      {
        ...event,
        id: "b",
        updatedAt: 40,
        activity: "review",
        reviewSessionId: "a",
        rating: "good",
      },
      {
        ...event,
        id: "chapter-one",
        updatedAt: 10,
        activity: "reading",
        activitySessionId: "visit",
      },
      {
        ...event,
        id: "turn-one",
        updatedAt: 20,
        activity: "speaking",
        activitySessionId: "a",
        seconds: 7,
      },
      {
        ...event,
        id: "a",
        updatedAt: 30,
        activity: "review",
        reviewSessionId: "a",
        rating: "hard",
      },
      {
        ...event,
        id: "turn-two",
        updatedAt: 70,
        activity: "speaking",
        activitySessionId: "a",
        seconds: 3,
      },
    ];

    expect(studyActivityGroups(sessions)).toMatchObject([
      { latest: { id: "turn-two" }, count: 2, seconds: 10 },
      { latest: { id: "dictation" }, count: 1, seconds: 30 },
      { latest: { id: "chapter-two" }, count: 2, seconds: 60 },
      { latest: { id: "b", rating: "good" }, count: 2, seconds: 60 },
    ]);
  });
});
