import type { StudyRating, StudyRecord, StudyRecordOf, StudyThread } from "./records";

type WeakStudyCard = {
  card: StudyRecordOf<"card">;
  rating: "again" | "hard";
  reviewedAt: number;
};

export function studyHighlightPreview(quote: string) {
  const text = quote.replace(/\s+/g, " ").trim();
  return text.length <= 140 ? text : `${text.slice(0, 139).trimEnd()}…`;
}

export function selectedStudyCards(
  ids: readonly string[] | undefined,
  cards: readonly StudyRecordOf<"card">[],
) {
  const byId = new Map(cards.map((card) => [card.id, card]));
  return [...new Set(ids)].flatMap((id) => byId.get(id) ?? []);
}

export function activeStudyCard(cards: readonly StudyRecordOf<"card">[], id: string | undefined) {
  return cards.find((card) => card.id === id) ?? cards[0];
}

export function recentPracticeCards(messages: StudyThread["messages"]) {
  const recent = messages.slice(-16).toReversed();
  return [...new Set(recent.flatMap(({ practiceCardId }) => (practiceCardId ? [practiceCardId] : [])))];
}

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
