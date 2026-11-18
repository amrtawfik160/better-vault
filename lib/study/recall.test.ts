import { describe, expect, it } from "vitest";
import { difficultStudyItems } from "./recall";
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
const highlight = (id: string): StudyRecordOf<"highlight"> => ({
  id,
  kind: "highlight",
  bookId: "book",
  section: 0,
  quote: id,
  offset: 0,
  color: "yellow",
  note: "",
  schedule: freshSchedule(0),
  updatedAt: 0,
});
const review = (
  itemId: string,
  rating: StudyRating,
  updatedAt: number,
  reviewSessionId?: string,
): StudyRecordOf<"session"> => ({
  id: `${itemId}-${updatedAt}`,
  kind: "session",
  activity: "review",
  itemId,
  rating,
  reviewSessionId,
  updatedAt,
  seconds: 1,
  count: 1,
});

describe("difficult items", () => {
  it("uses the latest grade for live cards and highlights and prioritizes missed answers", () => {
    const weak = difficultStudyItems(
      [card("remembered"), highlight("missed"), card("difficult"), highlight("new")],
      [
        review("remembered", "good", 5),
        review("remembered", "again", 1),
        review("missed", "again", 2),
        review("difficult", "hard", 4),
        review("deleted", "again", 6),
      ],
    );
    expect(weak.map(({ item, rating }) => [item.id, rating])).toEqual([
      ["missed", "again"],
      ["difficult", "hard"],
    ]);
  });

  it("recaps only items whose latest grade is difficult and belongs to the completed session", () => {
    const items = [highlight("missed"), highlight("improved"), highlight("other")];
    const history = [
      review("missed", "hard", 1, "current"),
      review("improved", "again", 2, "current"),
      review("improved", "good", 3, "later"),
      review("other", "again", 4, "earlier"),
    ];
    expect(difficultStudyItems(items, history, "current").map(({ item }) => item.id)).toEqual([
      "missed",
    ]);
  });
});
