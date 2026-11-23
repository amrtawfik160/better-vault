import { studyHighlightColor, type StudyBook, type StudyRecord, type StudyRecordOf } from "./records";
import { studyCardOnlyScope, studyCardsInScope, studyHighlightsInScope } from "./review-session";

type Card = StudyRecordOf<"card">;
type Highlight = StudyRecordOf<"highlight">;
type Word = StudyRecordOf<"word">;
export type StudyCollectionItem = Card | Highlight | Word;

/** Query parameters that narrow Collection, shown as removable chips. */
export const studyCollectionScopes = ["book", "notebook", "note", "output", "card", "fromReport", "fromAnswer", "fromThread", "color"] as const;
export type StudyCollectionScope = (typeof studyCollectionScopes)[number];

/**
 * What Collection shows for a query: the highlights, flashcards and words in its scope.
 * A word's own card is shown as the word, so the flashcards leave it out unless one card is asked for.
 */
export function studyCollection(rows: StudyRecord[], params: URLSearchParams) {
  const bookId = params.get("book");
  const book = rows.find((row): row is StudyBook => row.kind === "book" && row.id === bookId);
  if (bookId && !book) return { book, cards: [], highlights: [], words: [] };
  const threadId = params.get("thread");
  const notebookId = params.get("notebook");
  const color = studyHighlightColor.safeParse(params.get("color")).data;
  const single = params.get("card") !== null;
  const cards = color
    ? []
    : studyCardsInScope(
        rows.filter((row): row is Card => row.kind === "card" && (single || row.origin?.kind !== "word")),
        params,
        book,
        rows.some((row) => row.kind === "thread" && row.id === threadId) ? threadId : null,
      );
  const highlights = studyHighlightsInScope(
    rows.filter((row): row is Highlight => row.kind === "highlight"),
    params,
    book,
  ).filter((row) => !color || row.color === color);
  const words =
    color || studyCardOnlyScope(params)
      ? []
      : rows.filter(
          (row): row is Word =>
            row.kind === "word" &&
            (!book ||
              row.bookId === book.id ||
              (row.origin?.kind === "book" && row.origin.bookId === book.id)) &&
            (!notebookId || row.notebookId === notebookId),
        );
  return { book, cards, highlights, words };
}

/** The text Collection's search looks through for one item. */
export function studyCollectionText(item: StudyCollectionItem) {
  const parts =
    item.kind === "card"
      ? [item.front, item.back, ...(item.quizChoices ?? []), ...item.tags]
      : item.kind === "highlight"
        ? [item.quote, item.note, item.cue ?? ""]
        : [
            item.term,
            item.translation,
            item.language,
            item.context,
            item.note,
            ...(item.examples ?? []).map(({ context }) => context),
          ];
  return parts.join(" ").toLowerCase();
}

export function studyCollectionSearch<T extends StudyCollectionItem>(items: T[], query: string) {
  const search = query.trim().toLowerCase();
  return search ? items.filter((item) => studyCollectionText(item).includes(search)) : items;
}
