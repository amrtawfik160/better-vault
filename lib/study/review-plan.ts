import type { StudyBook, StudyRecordOf } from "./records";
import { studyReviewKind } from "./review-session";

type ReviewItem = StudyRecordOf<"card" | "highlight">;

/** One notebook's share of today's review, for the plan's Include list. */
export interface ReviewPlanGroup {
  /** The notebook, or "" for items that belong to none. */
  notebookId: string;
  /** Due now, in the order they come due. */
  due: ReviewItem[];
  cards: number;
  words: number;
  highlights: number;
  /** Everything of this notebook that is reviewed, due or not. */
  total: number;
  /** The document most of the due items come from. */
  from?: string;
}

/** Which notebook an item belongs to: its own, or its document's. */
export function reviewNotebookOf(item: ReviewItem, books: ReadonlyMap<string, StudyBook>) {
  if (item.notebookId) return item.notebookId;
  const bookId =
    item.kind === "highlight" ? item.bookId : item.origin?.kind === "book" ? item.origin.bookId : undefined;
  return (bookId && books.get(bookId)?.notebookId) || "";
}

function documentOf(item: ReviewItem, books: ReadonlyMap<string, StudyBook>) {
  const bookId =
    item.kind === "highlight" ? item.bookId : item.origin?.kind === "book" ? item.origin.bookId : undefined;
  return bookId ? books.get(bookId)?.title : undefined;
}

/**
 * Today's review, a notebook at a time: the notebooks with something due,
 * the most due first, then those with nothing due (shown, but not offered).
 */
export function reviewPlan(
  items: readonly ReviewItem[],
  books: readonly StudyBook[],
  now: number,
): ReviewPlanGroup[] {
  const byId = new Map(books.map((book) => [book.id, book]));
  const groups = new Map<string, ReviewPlanGroup & { documents: Map<string, number> }>();
  for (const item of items.toSorted((a, b) => a.schedule.dueAt - b.schedule.dueAt)) {
    const notebookId = reviewNotebookOf(item, byId);
    let group = groups.get(notebookId);
    if (!group) {
      group = { notebookId, due: [], cards: 0, words: 0, highlights: 0, total: 0, documents: new Map() };
      groups.set(notebookId, group);
    }
    group.total++;
    if (item.schedule.dueAt > now) continue;
    group.due.push(item);
    const kind = studyReviewKind(item);
    if (kind === "word") group.words++;
    else if (kind === "highlight") group.highlights++;
    else group.cards++;
    const document = documentOf(item, byId);
    if (document) group.documents.set(document, (group.documents.get(document) ?? 0) + 1);
  }
  return [...groups.values()]
    .map(({ documents, ...group }) => ({
      ...group,
      from: [...documents.entries()].toSorted((a, b) => b[1] - a[1])[0]?.[0],
    }))
    .toSorted((a, b) => b.due.length - a.due.length || b.total - a.total);
}

/** The ids to review for the notebooks ticked (every one when none are given), a notebook at a time. */
export function reviewPlanIds(groups: readonly ReviewPlanGroup[], included?: ReadonlySet<string>) {
  return groups
    .filter(({ notebookId }) => !included || included.has(notebookId))
    .flatMap(({ due }) => due.map(({ id }) => id));
}
