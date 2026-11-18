import type { StudyRecord, StudyRecordOf, StudyReviewItemWrite, StudyThread } from "./records";

export function patchedStudyReviewItem(item: StudyRecord | undefined, write: StudyReviewItemWrite) {
  if (item?.kind !== write.kind) return;
  return { ...item, ...write.change, updatedAt: Math.max(item.updatedAt, write.updatedAt) };
}

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

export function latestStudyReviews(history: readonly StudyRecordOf<"session">[]) {
  const latest = new Map<string, StudyRecordOf<"session">>();
  for (const review of history) {
    if (review.activity !== "review" || !review.itemId || !review.rating) continue;
    const previous = latest.get(review.itemId);
    if (!previous || review.updatedAt >= previous.updatedAt) latest.set(review.itemId, review);
  }
  return latest;
}

export function difficultStudyItems(
  items: readonly StudyRecordOf<"card" | "highlight">[],
  history: readonly StudyRecordOf<"session">[],
  sessionId?: string,
) {
  const latest = latestStudyReviews(history);
  return items
    .flatMap((item) => {
      const review = latest.get(item.id);
      if (sessionId !== undefined && review?.reviewSessionId !== sessionId) return [];
      return review?.rating === "again" || review?.rating === "hard"
        ? [{ item, rating: review.rating, reviewedAt: review.updatedAt }]
        : [];
    })
    .sort((a, b) => {
      if (a.rating !== b.rating) return a.rating === "again" ? -1 : 1;
      return b.reviewedAt - a.reviewedAt;
    });
}
