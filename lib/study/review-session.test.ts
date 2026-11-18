import { describe, expect, it } from "vitest";
import type { StudyRecordOf } from "./records";
import { pendingReviewLearning, reviewQueue } from "./review-session";
import { freshSchedule, nextStudySchedule } from "./schedule";

const timestamp = 1_000_000;
const sessionId = "selected-review";

function card(id: string, rating: "again" | "good" | "easy"): StudyRecordOf<"card"> {
  return {
    id,
    kind: "card",
    front: "Recall",
    back: "Answer",
    tags: [],
    schedule: nextStudySchedule(freshSchedule(timestamp), rating, timestamp),
    updatedAt: timestamp,
  };
}

function grade(
  itemId: string,
  reviewSessionId = sessionId,
  updatedAt = timestamp,
): StudyRecordOf<"session"> {
  return {
    id: `grade-${itemId}-${updatedAt}`,
    kind: "session",
    activity: "review",
    rating: "again",
    itemId,
    reviewSessionId,
    updatedAt,
    count: 1,
    seconds: 5,
  };
}

describe("learning steps in a review session", () => {
  it("waits for short learning steps from the current session and releases each at its due time", () => {
    const again = card("again", "again");
    const good = card("good", "good");
    const easy = card("easy", "easy");
    const items = [easy, good, again];
    const history = items.map(({ id }) => grade(id));

    expect(pendingReviewLearning(items, history, sessionId, timestamp)).toEqual([again, good]);
    expect(reviewQueue(items, null, again.schedule.dueAt - 1)).toEqual([]);
    expect(reviewQueue(items, null, again.schedule.dueAt)).toEqual([again]);
    expect(pendingReviewLearning(items, history, sessionId, again.schedule.dueAt)).toEqual([good]);
  });

  it("does not keep another session's review or a deleted item in the waiting queue", () => {
    const again = card("again", "again");
    const unrelated = grade(again.id, "another-review", timestamp + 1);
    const old = grade(again.id);

    expect(
      pendingReviewLearning([again], [old, unrelated, grade("removed")], sessionId, timestamp),
    ).toEqual([]);
    expect(pendingReviewLearning([again], [old], sessionId, timestamp)).toEqual([again]);
  });
});
