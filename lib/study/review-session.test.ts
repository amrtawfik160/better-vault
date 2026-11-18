import { describe, expect, it, vi } from "vitest";
import type { StudyRecordOf } from "./records";
import { pendingReviewLearning, reviewCollection, reviewQueue, savedReview, saveReviewCheckpoint } from "./review-session";
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

it("reviews only the selected cards from one Tutor answer in draft order", () => {
  const thread: StudyRecordOf<"thread"> = {
    id: "tutor", kind: "thread", scope: "general", goal: "book", title: "Tutor",
    messages: [{ role: "assistant", text: "First" }, { role: "assistant", text: "Second" }], updatedAt: 1,
  };
  const fromAnswer = (id: string, message: number, threadId = thread.id): StudyRecordOf<"card"> => ({
    ...card(id, "easy"), origin: { kind: "tutor", threadId, message },
  });
  const first = fromAnswer("first", 0);
  const second = fromAnswer("second", 0);
  const rows = [thread, fromAnswer("other-answer", 1), second, fromAnswer("other-thread", 0, "unrelated"), first];
  const params = new URLSearchParams({ thread: thread.id, fromAnswer: "0" });
  expect(reviewCollection(rows, params)).toEqual([second, first]);
  expect(reviewCollection(rows, params, [first.id, "other-answer", second.id, first.id])).toEqual([first, second]);
  params.set("thread", "unrelated");
  expect(reviewCollection(rows, params)).toEqual([]);
});

it("keeps the interrupted review on Today while reviewing newly saved correction cards", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  try {
    const parent = {
      path: "/?view=study&tab=review", state: { studyReviewSession: "original", studyReviewVault: "work" },
    };
    const child = {
      path: "/?view=study&tab=review&thread=tutor&fromAnswer=1",
      state: { ...parent.state, studyReviewSession: "correction", studyReturn: parent },
    };
    const snapshot = { revealed: "first", rated: 0, practiced: null, position: { id: "first", dueAt: timestamp } };
    saveReviewCheckpoint("work", parent, snapshot);
    saveReviewCheckpoint("work", child, { ...snapshot, revealed: "" });
    saveReviewCheckpoint("work", child, { revealed: "", rated: 1, practiced: null });
    expect(savedReview("work")).toEqual({ ...parent, snapshot });
  } finally {
    vi.unstubAllGlobals();
  }
});
