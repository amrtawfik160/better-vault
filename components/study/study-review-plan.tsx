import { Book02Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { DirectionalText } from "@/components/common/directional-text";
import { Segmented } from "@/components/common/segmented";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Select } from "@/components/panelui/select";
import { Checkbox } from "@/components/ui/checkbox";
import type { StudyBook, StudyRecordOf } from "@/lib/study/records";
import { reviewNotebookOf, reviewPlan, reviewPlanIds } from "@/lib/study/review-plan";
import { cn } from "@/lib/utils";

type Card = StudyRecordOf<"card">;
type Highlight = StudyRecordOf<"highlight">;
type Word = StudyRecordOf<"word">;
type DeckTab = "cards" | "words";

const DAY = 24 * 60 * 60 * 1000;
const DECK_ROWS = 6;

/**
 * Review before it starts: what is due today, by notebook, with the
 * notebooks to include and Start review; then the deck, to look through.
 */
export function StudyReviewPlan({
  items,
  cards,
  words,
  books,
  notebookTitles,
  now,
  next,
  lastRead,
  start,
  browse,
  openBook,
}: {
  /** Everything reviewed: cards (words' cards too) and highlights, due or not. */
  items: (Card | Highlight)[];
  cards: Card[];
  words: Word[];
  books: StudyBook[];
  notebookTitles: ReadonlyMap<string, string>;
  now: number;
  /** When the next item comes due, when nothing is due now. */
  next?: number;
  /** The document read last, to make cards from when the deck is empty. */
  lastRead?: StudyBook;
  /** Starts the review with these items, in this order. */
  start: (ids: string[]) => void;
  /** Opens the deck's full list (to look through, edit or add a card). */
  browse: (filter: DeckTab) => void;
  openBook: (book: StudyBook) => void;
}) {
  const { t, i18n } = useTranslation("home");
  const plan = useMemo(() => reviewPlan(items, books, now), [items, books, now]);
  const offered = plan.filter(({ due }) => due.length > 0);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const included = new Set(offered.map(({ notebookId }) => notebookId).filter((id) => !excluded.has(id)));
  const ids = reviewPlanIds(plan, included);
  const dueCount = offered.reduce((sum, { due }) => sum + due.length, 0);
  const notebookName = (id: string) => (id ? (notebookTitles.get(id) ?? t("study.reviewPlan.unknownNotebook")) : t("study.reviewPlan.noNotebook"));
  const date = new Intl.DateTimeFormat(i18n.language, { weekday: "long", day: "numeric", month: "long" }).format(now);
  const emptyDeck = items.length === 0 && words.length === 0;

  const counts = (group: (typeof plan)[number]) =>
    [
      group.cards ? t("study.reviewPlan.cards", { count: group.cards }) : "",
      group.words ? t("study.reviewPlan.words", { count: group.words }) : "",
      group.highlights ? t("study.reviewPlan.highlights", { count: group.highlights }) : "",
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="mx-auto w-full max-w-2xl space-y-10">
      <section aria-labelledby="review-plan-title" className="space-y-5">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{date}</p>
          <h2 id="review-plan-title" className="text-2xl font-semibold tracking-tight">
            {emptyDeck
              ? t("study.reviewPlan.emptyTitle")
              : dueCount
                ? t("study.reviewPlan.dueTitle", { count: dueCount })
                : t("study.reviewPlan.nothingTitle")}
          </h2>
          <p className="text-sm text-pretty text-muted-foreground">
            {emptyDeck
              ? t("study.reviewPlan.emptyBody")
              : dueCount
                ? t("study.reviewPlan.queue")
                : next
                  ? t("study.reviewPlan.nextDue", { when: dueWhen(next, now, i18n.language, t) })
                  : t("study.reviewPlan.nothingBody")}
          </p>
        </div>

        {dueCount ? (
          <>
            <fieldset className="space-y-0">
              <legend className="mb-1 text-sm font-medium">{t("study.reviewPlan.include")}</legend>
              {plan.map((group) => {
                const on = included.has(group.notebookId);
                const off = group.due.length === 0;
                const id = `review-plan-${group.notebookId || "none"}`;
                return (
                  <label
                    key={group.notebookId || "none"}
                    htmlFor={id}
                    className={cn(
                      "flex min-h-14 items-center gap-3 border-t py-1.5 text-sm",
                      off ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer",
                    )}
                  >
                    <Checkbox
                      id={id}
                      checked={on}
                      disabled={off}
                      onCheckedChange={(checked) =>
                        setExcluded((current) => {
                          const nextSet = new Set(current);
                          if (checked) nextSet.delete(group.notebookId);
                          else nextSet.add(group.notebookId);
                          return nextSet;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <DirectionalText as="span" text={notebookName(group.notebookId)} className="block truncate font-medium" />
                      <span className="block truncate text-xs text-muted-foreground">
                        {off ? t("study.reviewPlan.notDue") : (group.from ?? "")}
                      </span>
                    </span>
                    <span className="shrink-0 text-end text-xs tabular-nums">
                      <span className={cn("block", off ? "text-muted-foreground" : "text-foreground")}>
                        {off ? t("study.reviewPlan.noneDue") : counts(group)}
                      </span>
                      <span className="block text-muted-foreground">
                        {t("study.reviewPlan.ofTotal", { count: group.total })}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg" disabled={ids.length === 0} onClick={() => start(ids)}>
                {t("study.reviewPlan.start")}
                <span className="text-primary-foreground/70 tabular-nums">{ids.length}</span>
              </Button>
              {ids.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("study.reviewPlan.tick")}</p>
              ) : null}
            </div>
          </>
        ) : lastRead ? (
          <button
            type="button"
            onClick={() => openBook(lastRead)}
            className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl border px-4 text-start text-sm outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <Icon icon={Book02Icon} size={16} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{t("study.reviewPlan.makeCards")}</span>
              <span className="text-muted-foreground"> · </span>
              <DirectionalText as="span" text={lastRead.title} className="text-muted-foreground" />
            </span>
          </button>
        ) : null}
      </section>

      {emptyDeck ? null : (
        <Deck
          cards={cards}
          words={words}
          books={books}
          notebookName={notebookName}
          now={now}
          browse={browse}
        />
      )}
    </div>
  );
}

function dueWhen(
  at: number,
  now: number,
  language: string,
  t: (key: "study.reviewPlan.dueToday" | "study.reviewPlan.dueTomorrow", options: { time: string }) => string,
) {
  const time = new Intl.DateTimeFormat(language, { hour: "numeric", minute: "2-digit" }).format(at);
  const day = (value: number) => new Date(value).toDateString();
  if (day(at) === day(now)) return t("study.reviewPlan.dueToday", { time });
  if (day(at) === day(now + DAY)) return t("study.reviewPlan.dueTomorrow", { time });
  return new Intl.DateTimeFormat(language, { weekday: "long", day: "numeric", month: "long" }).format(at);
}

/** The deck, from the plan: cards and words, by notebook, with the full list a click away. */
function Deck({
  cards,
  words,
  books,
  notebookName,
  now,
  browse,
}: {
  cards: Card[];
  words: Word[];
  books: StudyBook[];
  notebookName: (id: string) => string;
  now: number;
  browse: (filter: DeckTab) => void;
}) {
  const { t, i18n } = useTranslation("home");
  const [tab, setTab] = useState<DeckTab>("cards");
  const [notebook, setNotebook] = useState("all");
  const byBook = useMemo(() => new Map(books.map((book) => [book.id, book])), [books]);
  const wordCards = useMemo(() => {
    const map = new Map<string, Card>();
    for (const card of cards) if (card.origin?.kind === "word") map.set(card.origin.wordId, card);
    return map;
  }, [cards]);
  const plainCards = cards.filter((card) => card.origin?.kind !== "word");
  const rows =
    tab === "cards"
      ? plainCards.map((card) => ({
          id: card.id,
          question: card.front,
          answer: card.back,
          notebookId: reviewNotebookOf(card, byBook),
          dueAt: card.schedule.dueAt,
        }))
      : words.map((word) => ({
          id: word.id,
          question: word.term,
          answer: word.translation,
          notebookId: word.notebookId ?? (word.bookId ? byBook.get(word.bookId)?.notebookId : undefined) ?? "",
          dueAt: wordCards.get(word.id)?.schedule.dueAt,
        }));
  const notebooks = [...new Set(rows.map(({ notebookId }) => notebookId))];
  const shown = rows
    .filter((row) => notebook === "all" || row.notebookId === notebook)
    .toSorted((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
  const relative = new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" });
  const due = (at: number | undefined) =>
    at === undefined
      ? t("study.reviewPlan.notScheduled")
      : at <= now
        ? t("study.reviewPlan.dueNow")
        : relative.format(Math.max(1, Math.round((at - now) / DAY)), "day");
  const notebookOptions = [
    { value: "all", label: t("study.reviewPlan.allNotebooks") },
    ...notebooks.map((id) => ({ value: id, label: notebookName(id) })),
  ];

  return (
    <section aria-labelledby="review-deck-title" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="review-deck-title" className="me-2 text-sm font-medium">
          {t("study.reviewPlan.deck")}
        </h3>
        <Segmented<DeckTab>
          size="sm"
          aria-label={t("study.reviewPlan.deck")}
          value={tab}
          onValueChange={(value) => {
            setTab(value);
            setNotebook("all");
          }}
          options={[
            { value: "cards", label: t("study.reviewPlan.deckCards", { count: plainCards.length }) },
            { value: "words", label: t("study.reviewPlan.deckWords", { count: words.length }) },
          ]}
        />
        {notebooks.length > 1 ? (
          <Select
            items={notebookOptions}
            value={notebook}
            onValueChange={(value) => typeof value === "string" && setNotebook(value)}
          >
            <Select.Trigger size="sm" aria-label={t("study.reviewPlan.notebookFilter")} className="w-auto max-w-56">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {notebookOptions.map((option) => (
                <Select.Item key={option.value} value={option.value}>
                  {option.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        ) : null}
        <Button variant="ghost" size="sm" className="ms-auto" onClick={() => browse("cards")}>
          <Icon icon={PlusSignIcon} size={14} />
          {t("study.reviewPlan.addCard")}
        </Button>
      </div>
      {shown.length ? (
        <ul className="divide-y rounded-2xl border">
          {shown.slice(0, DECK_ROWS).map((row) => (
            <li key={row.id} className="flex min-h-14 items-center gap-4 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <DirectionalText as="span" text={row.question} className="block truncate font-medium" />
                <DirectionalText as="span" text={row.answer} className="block truncate text-muted-foreground" />
              </span>
              <span className="hidden shrink-0 text-end text-xs text-muted-foreground tabular-nums sm:block">
                <DirectionalText as="span" text={notebookName(row.notebookId)} className="block max-w-40 truncate" />
                <span className="block">{due(row.dueAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t(tab === "cards" ? "study.reviewPlan.noCards" : "study.reviewPlan.noWords")}
        </p>
      )}
      {shown.length > DECK_ROWS ? (
        <Button variant="ghost" size="sm" onClick={() => browse(tab)}>
          {t("study.reviewPlan.showAll", { count: shown.length })}
        </Button>
      ) : null}
    </section>
  );
}
