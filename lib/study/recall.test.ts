import { describe, expect, it } from "vitest";
import { weakStudyCards } from "./recall";
import { freshSchedule } from "./schedule";
import type { StudyRating, StudyRecordOf } from "./records";

const card = (id: string): StudyRecordOf<"card"> => ({
  id,
  kind: "card",
  front: id,
  back: "answer",
  tags: [],
  schedule: freshSchedule(0),
  updatedAt: 0,
});
const review = (
  itemId: string,
  rating: StudyRating,
  updatedAt: number,
): StudyRecordOf<"session"> => ({
  id: `${itemId}-${updatedAt}`,
  kind: "session",
  activity: "review",
  itemId,
  rating,
  updatedAt,
  seconds: 1,
  count: 1,
});

describe("weak cards", () => {
  it("uses the latest grade for each live card and prioritizes missed answers", () => {
    const weak = weakStudyCards([
      card("remembered"),
      card("missed"),
      card("difficult"),
      card("new"),
      review("remembered", "good", 5),
      review("remembered", "again", 1),
      review("missed", "again", 2),
      review("difficult", "hard", 4),
      review("deleted", "again", 6),
    ]);
    expect(weak.map(({ card, rating }) => [card.id, rating])).toEqual([
      ["missed", "again"],
      ["difficult", "hard"],
    ]);
  });
});
