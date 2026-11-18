import type { StudyRating, StudyRecord, StudyRecordOf } from "./records";

type WeakStudyCard = {
  card: StudyRecordOf<"card">;
  rating: "again" | "hard";
  reviewedAt: number;
};

/** Find active cards whose latest scheduled review showed a recall gap. */
export function weakStudyCards(rows: readonly StudyRecord[]) {
  const latest = new Map<string, { rating: StudyRating; at: number }>();
  for (const row of rows) {
    if (row.kind !== "session" || row.activity !== "review" || !row.itemId || !row.rating) continue;
    if ((latest.get(row.itemId)?.at ?? -Infinity) <= row.updatedAt)
      latest.set(row.itemId, { rating: row.rating, at: row.updatedAt });
  }
  return rows
    .filter((row) => row.kind === "card")
    .flatMap<WeakStudyCard>((card) => {
      const review = latest.get(card.id);
      return review?.rating === "again" || review?.rating === "hard"
        ? [{ card, rating: review.rating, reviewedAt: review.at }]
        : [];
    })
    .sort((a, b) => {
      if (a.rating !== b.rating) return a.rating === "again" ? -1 : 1;
      return b.reviewedAt - a.reviewedAt;
    });
}
