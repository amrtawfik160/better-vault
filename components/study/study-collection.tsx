import {
  Add01Icon,
  Cancel01Icon,
  Copy01Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  Note01Icon,
  PencilEdit01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { useEffect, useId, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DirectionalText } from "@/components/common/directional-text";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Dialog } from "@/components/panelui/dialog";
import { Input } from "@/components/panelui/input";
import { Menu } from "@/components/panelui/menu";
import { Textarea } from "@/components/panelui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  removeStudyRecord,
  saveStudyCard,
  saveStudyNote,
  saveStudyWord,
  studyId,
  studyVocabularyCards,
  updateStudyReviewItem,
  updateStudyWord,
} from "@/lib/db/study";
import { studyCollectionSearch, type StudyCollectionItem } from "@/lib/study/collection";
import { originHref, studyHighlightOrigin, type StudyCollectionFilter } from "@/lib/study/links";
import { studyHighlightPreview } from "@/lib/study/recall";
import { quizChoicesText } from "@/lib/study/quiz-cards";
import {
  studyHighlightColor,
  type StudyBook,
  type StudyCardEdit,
  type StudyHighlightColor,
  type StudyRecordOf,
  type StudyWord,
} from "@/lib/study/records";
import { linkedVocabularyCard, vocabularyCardId, vocabularyCardSides, vocabularyOrigin } from "@/lib/study/vocabulary";
import { textDirection } from "@/lib/text/direction";
import { cn } from "@/lib/utils";
import { StudyCardChoices } from "./study-card-choices";
import { studyDueLabel } from "./study-due";
import { StudyFlashcardDrafts } from "./study-flashcard-drafts";
import { StudyFlashcardGenerator } from "./study-flashcard-generator";
import { highlightColors } from "./study-highlight-colors";
import { StudyListenButton } from "./study-listen";
import { StudyOriginLink } from "./study-origin-link";
import { StudyText } from "./study-text";
import { useStudyClock } from "./use-study-clock";

type Card = StudyRecordOf<"card">;
type Highlight = StudyRecordOf<"highlight">;
type CardEditor = StudyCardEdit & { id: string; mode: "create" | "edit" };
type ReviewKind = "highlights" | "cards" | "vocabulary" | undefined;
export type StudyCollectionChip = { key: string; label: string };

const reviewKinds: Record<StudyCollectionFilter, ReviewKind> = {
  all: undefined,
  highlights: "highlights",
  cards: "cards",
  words: "vocabulary",
};
const kindDots = { card: "bg-chart-3", word: "bg-chart-2" };

/** Highlights, flashcards and words in one place, each kept as a card you can review, edit or discuss. */
export function StudyCollection({
  filter,
  onFilterChange,
  cards,
  highlights,
  words,
  allCards,
  books,
  vaultId,
  chips,
  clearChip,
  clearChips,
  links,
  focusedWord,
  creation,
  review,
  practiceCards,
  discussHighlights,
  openingPractice,
  locate,
  color,
  onColorChange,
}: {
  color?: StudyHighlightColor;
  onColorChange: (color: StudyHighlightColor | undefined) => void;
  filter: StudyCollectionFilter;
  onFilterChange: (filter: StudyCollectionFilter) => void;
  cards: Card[];
  highlights: Highlight[];
  words: StudyWord[];
  allCards: Card[];
  books: StudyBook[];
  vaultId: string;
  chips: StudyCollectionChip[];
  clearChip: (key: string) => void;
  clearChips: () => void;
  links?: ReactNode;
  focusedWord?: string;
  creation: Pick<Card, "notebookId" | "origin" | "tags" | "vaultId"> | false;
  review: (kind: ReviewKind, ids: string[], practiceOnly?: boolean) => void;
  practiceCards: (ids: string[]) => void;
  discussHighlights: (ids: string[]) => void;
  openingPractice: boolean;
  locate: (highlight: Highlight) => void;
}) {
  const { t, i18n } = useTranslation("home");
  const now = useStudyClock([...cards, ...highlights]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [cardEditor, setCardEditor] = useState<CardEditor | null>(null);
  const [wordEditor, setWordEditor] = useState<{ mode: "add" | "edit"; word: StudyWord } | null>(null);
  const [editingHighlight, setEditingHighlight] = useState<Highlight | null>(null);
  const [deleting, setDeleting] = useState<StudyCollectionItem[]>([]);
  const [generating, setGenerating] = useState(false);
  const [opening, setOpening] = useState(false);
  const openingCards = useRef<AbortController | null>(null);
  const focus = useRef<HTMLElement>(null);
  useEffect(() => () => openingCards.current?.abort(), []);
  useEffect(() => {
    if (!focusedWord) return;
    focus.current?.scrollIntoView({ block: "center" });
    focus.current?.focus({ preventScroll: true });
  }, [focusedWord, words.length]);

  const bookTitles = new Map(books.map(({ id, title }) => [id, title]));
  const cardsById = new Map(allCards.map((card) => [card.id, card]));
  const wordCard = (word: StudyWord) => linkedVocabularyCard(cardsById.get(vocabularyCardId(word.id)), word);
  const found = {
    highlights: studyCollectionSearch(highlights, query),
    cards: studyCollectionSearch(cards, query),
    words: studyCollectionSearch(words, query),
  };
  const visible: StudyCollectionItem[] =
    filter === "all"
      ? [...found.highlights, ...found.cards, ...found.words].toSorted((a, b) => b.updatedAt - a.updatedAt)
      : found[filter];
  const selectedIds = new Set(selected);
  const chosen = visible.filter(({ id }) => selectedIds.has(id));
  const target = chosen.length ? chosen : visible;
  const targetCards = target.filter((item): item is Card => item.kind === "card");
  const targetHighlights = target.filter((item): item is Highlight => item.kind === "highlight");
  const targetWords = target.filter(
    (item): item is StudyWord => item.kind === "word" && Boolean(wordCard(item) || vocabularyCardSides(item)),
  );
  const reviewable = targetCards.length + targetHighlights.length + targetWords.length;
  const scoped = chips.length > 0;
  const counts = {
    all: highlights.length + cards.length + words.length,
    highlights: highlights.length,
    cards: cards.length,
    words: words.length,
  };

  async function reviewTarget(practiceOnly = false) {
    if (openingCards.current || !reviewable) return;
    const request = new AbortController();
    openingCards.current = request;
    setOpening(true);
    try {
      const fromWords = targetWords.length
        ? await studyVocabularyCards(targetWords.map(({ id }) => id), vaultId)
        : [];
      if (request.signal.aborted) return;
      const ids = [...targetCards, ...targetHighlights].map(({ id }) => id).concat(fromWords);
      if (ids.length) review(reviewKinds[filter], ids, practiceOnly);
      else toast.info(t("study.vocabulary.noCards"));
    } catch (error) {
      if (!request.signal.aborted) toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      openingCards.current = null;
      if (!request.signal.aborted) setOpening(false);
    }
  }

  function copyCards(items: Card[]) {
    const text = items
      .map((card) => {
        const choices = card.quizChoices?.length ? `\n${quizChoicesText(card.quizChoices)}` : "";
        return `Q: ${card.front}${choices}\nA: ${card.back}`;
      })
      .join("\n\n");
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success(t("study.collection.copied")))
      .catch(() => toast.error(t("study.collection.copyFailed")));
  }

  function toggle(id: string, checked: boolean) {
    setSelected((ids) => (checked ? [...ids, id] : ids.filter((entry) => entry !== id)));
  }

  function newWord(): StudyWord {
    return {
      id: studyId(),
      kind: "word",
      term: "",
      translation: "",
      context: "",
      language: "",
      note: "",
      updatedAt: Date.now(),
    };
  }

  const due = (dueAt: number) => studyDueLabel(t, i18n.language, dueAt, now);
  const selectedCards = chosen.filter((item): item is Card => item.kind === "card");

  return (
    <section className="space-y-5" aria-labelledby="study-collection-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t("study.tabs.collection")}</p>
          <h2 id="study-collection-title" className="text-2xl font-semibold tracking-tight">
            {t("study.collection.title")}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!scoped && !generating ? <StudyFlashcardDrafts key={vaultId} vaultId={vaultId} /> : null}
          <Menu>
            <Menu.Trigger render={<Button variant="outline" shape="pill" />}>
              <Icon icon={Add01Icon} />
              {t("study.collection.add")}
            </Menu.Trigger>
            <Menu.Content align="end">
              {creation === false ? null : (
                <Menu.Item
                  onClick={() =>
                    setCardEditor({ id: studyId(), mode: "create", front: "", back: "", tags: creation.tags })
                  }
                >
                  {t("study.collection.newCard")}
                </Menu.Item>
              )}
              <Menu.Item onClick={() => setWordEditor({ mode: "add", word: newWord() })}>
                {t("study.collection.addWord")}
              </Menu.Item>
              {!scoped ? (
                <Menu.Item onClick={() => setGenerating(true)}>{t("study.collection.generate")}</Menu.Item>
              ) : null}
            </Menu.Content>
          </Menu>
          <Menu>
            <Menu.Trigger
              render={<Button variant="ghost" shape="pill" size="icon" />}
              aria-label={t("study.collection.more")}
              disabled={!visible.length}
            >
              <Icon icon={MoreHorizontalIcon} />
            </Menu.Trigger>
            <Menu.Content align="end">
              <Menu.Item disabled={!reviewable || opening} onClick={() => void reviewTarget(true)}>
                {t("study.recall.practiceNow")}
              </Menu.Item>
              {targetCards.length ? (
                <Menu.Item
                  disabled={openingPractice}
                  onClick={() => practiceCards(targetCards.map(({ id }) => id))}
                >
                  {t("study.collection.practiceCards", { count: targetCards.length })}
                </Menu.Item>
              ) : null}
              {targetHighlights.length ? (
                <Menu.Item
                  disabled={openingPractice}
                  onClick={() => discussHighlights(targetHighlights.map(({ id }) => id))}
                >
                  {t("study.highlights.discuss", { count: targetHighlights.length })}
                </Menu.Item>
              ) : null}
            </Menu.Content>
          </Menu>
          <Button shape="pill" disabled={!reviewable} loading={opening} onClick={() => void reviewTarget()}>
            {chosen.length
              ? t("study.collection.reviewSelected", { count: chosen.length })
              : t("study.collection.reviewThese")}
          </Button>
        </div>
      </div>

      {generating && !scoped ? (
        <StudyFlashcardGenerator key={vaultId} close={() => setGenerating(false)} vaultId={vaultId} />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("study.collection.filterLabel")}>
          {(["all", "highlights", "cards", "words"] as const).map((entry) => (
            <Button
              key={entry}
              size="sm"
              shape="pill"
              variant={filter === entry ? "default" : "outline"}
              aria-pressed={filter === entry}
              onClick={() => {
                setSelected([]);
                onFilterChange(entry);
              }}
            >
              {t(`study.collection.filters.${entry}`)}
              <span className="tabular-nums opacity-70">{counts[entry]}</span>
            </Button>
          ))}
          {filter === "highlights" ? (
            <div
              className="ms-1 flex items-center gap-0.5 border-s ps-2"
              role="group"
              aria-label={t("study.collection.colorFilter")}
            >
              {studyHighlightColor.options.map((name) => (
                <Button
                  key={name}
                  size="icon-sm"
                  shape="pill"
                  variant={color === name ? "outline" : "ghost"}
                  aria-pressed={color === name}
                  aria-label={t(`study.highlights.colors.${name}`)}
                  title={t(`study.highlights.colors.${name}`)}
                  onClick={() => onColorChange(color === name ? undefined : name)}
                >
                  <span aria-hidden="true" className={cn("size-3 rounded-full", highlightColors[name])} />
                </Button>
              ))}
            </div>
          ) : null}
        </div>
        <label className="relative w-full sm:w-72">
          <span className="sr-only">{t("study.collection.search")}</span>
          <Icon
            icon={Search01Icon}
            size={16}
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            className="ps-9"
            placeholder={t("study.collection.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {chips.length || links ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {chips.length ? <span className="text-muted-foreground">{t("study.collection.scopeLabel")}</span> : null}
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/50 ps-3 pe-1"
            >
              <span className="truncate" dir="auto">
                {chip.label}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                shape="pill"
                className="size-6"
                aria-label={t("study.collection.removeScope", { label: chip.label })}
                onClick={() => clearChip(chip.key)}
              >
                <Icon icon={Cancel01Icon} size={14} />
              </Button>
            </span>
          ))}
          {chips.length > 1 ? (
            <Button variant="link" size="sm" onClick={clearChips}>
              {t("study.collection.clearScopes")}
            </Button>
          ) : null}
          {links}
        </div>
      ) : null}

      {chosen.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-muted/40 px-3 py-2 text-sm" role="status">
          <span className="me-auto font-medium">{t("study.collection.selected", { count: chosen.length })}</span>
          {selectedCards.length ? (
            <Button size="sm" variant="ghost" onClick={() => copyCards(selectedCards)}>
              <Icon icon={Copy01Icon} />
              {t("study.collection.copyCards")}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setDeleting(chosen)}>
            <Icon icon={Delete02Icon} />
            {t("study.collection.delete")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            {t("study.collection.clearSelection")}
          </Button>
        </div>
      ) : null}

      {visible.length ? (
        <ul className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((item) => {
            const select = {
              checked: selectedIds.has(item.id),
              change: (checked: boolean) => toggle(item.id, checked),
            };
            if (item.kind === "highlight")
              return (
                <HighlightItem
                  key={item.id}
                  item={item}
                  book={bookTitles.get(item.bookId)}
                  due={due(item.schedule.dueAt)}
                  select={select}
                  editing={editingHighlight?.id === item.id ? editingHighlight : null}
                  setEditing={setEditingHighlight}
                  locate={() => locate(item)}
                  discuss={() => discussHighlights([item.id])}
                  openingPractice={openingPractice}
                  remove={() => setDeleting([item])}
                />
              );
            if (item.kind === "card")
              return (
                <CardItem
                  key={item.id}
                  item={item}
                  due={due(item.schedule.dueAt)}
                  select={select}
                  edit={() => setCardEditor({ ...item, mode: "edit" })}
                  practice={() => practiceCards([item.id])}
                  openingPractice={openingPractice}
                  remove={() => setDeleting([item])}
                />
              );
            const card = wordCard(item);
            return (
              <WordItem
                key={item.id}
                ref={focusedWord === item.id ? focus : undefined}
                focused={focusedWord === item.id}
                item={item}
                book={item.bookId ? bookTitles.get(item.bookId) : undefined}
                due={card ? due(card.schedule.dueAt) : t("study.collection.notInReview")}
                select={select}
                reviewable={Boolean(card || vocabularyCardSides(item))}
                opening={opening}
                reviewWord={() => {
                  if (openingCards.current) return;
                  const request = new AbortController();
                  openingCards.current = request;
                  setOpening(true);
                  void studyVocabularyCards([item.id], vaultId)
                    .then((ids) => {
                      if (request.signal.aborted) return;
                      if (ids.length) review("vocabulary", ids);
                      else toast.info(t("study.vocabulary.noCards"));
                    })
                    .catch((error: Error) => toast.error(error.message))
                    .finally(() => {
                      openingCards.current = null;
                      if (!request.signal.aborted) setOpening(false);
                    });
                }}
                edit={() => setWordEditor({ mode: "edit", word: item })}
                remove={() => setDeleting([item])}
              />
            );
          })}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          {query.trim()
            ? t("study.collection.noMatches", { query: query.trim() })
            : counts[filter] || !scoped
              ? t(`study.collection.empty.${filter}`)
              : t("study.collection.noMatchesScope")}
        </div>
      )}

      {cardEditor ? (
        <CardEditorDialog
          editor={cardEditor}
          setEditor={setCardEditor}
          creation={creation}
        />
      ) : null}
      {wordEditor ? (
        <WordEditorDialog editor={wordEditor} setEditor={setWordEditor} vaultId={vaultId} />
      ) : null}
      <ConfirmDialog
        open={deleting.length > 0}
        onOpenChange={(open) => {
          if (!open) setDeleting([]);
        }}
        title={t("study.collection.deleteTitle", { count: deleting.length })}
        body={t("study.collection.deleteBody", { count: deleting.length })}
        confirmLabel={t("study.collection.delete")}
        onConfirm={async () => {
          const ids = deleting.map(({ id }) => id);
          await Promise.all(ids.map(removeStudyRecord));
          setSelected((value) => value.filter((id) => !ids.includes(id)));
          setDeleting([]);
        }}
      />
    </section>
  );
}

type Selectable = { checked: boolean; change: (checked: boolean) => void };

function ItemShell({
  kind,
  dot,
  source,
  label,
  select,
  due,
  actions,
  children,
  focused,
  ref,
  id,
}: {
  kind: string;
  dot: string;
  source?: string;
  label: string;
  select: Selectable;
  due: string;
  actions: ReactNode;
  children: ReactNode;
  focused?: boolean;
  ref?: Ref<HTMLElement>;
  id?: string;
}) {
  const { t } = useTranslation("home");
  return (
    <li className="min-w-0">
      <article
        ref={ref}
        id={id}
        tabIndex={focused ? -1 : undefined}
        className={cn(
          "flex min-w-0 scroll-mt-32 flex-col gap-3 rounded-2xl border bg-card p-4 shadow-xs outline-none",
          select.checked && "ring-2 ring-ring/40",
          focused && "ring-2 ring-ring",
        )}
      >
        <header className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={select.checked}
            onCheckedChange={(checked) => select.change(checked === true)}
            aria-label={t("study.collection.select", { text: label })}
          />
          <span className="inline-flex shrink-0 items-center gap-1.5 font-medium">
            <span aria-hidden="true" className={cn("size-2 rounded-full", dot)} />
            {kind}
          </span>
          {source ? (
            <span className="ms-auto min-w-0 truncate" dir="auto">
              {source}
            </span>
          ) : null}
        </header>
        {children}
        <footer className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
          <span className="me-auto">{due}</span>
          <span className="ms-auto flex items-center gap-0.5">{actions}</span>
        </footer>
      </article>
    </li>
  );
}

function ItemMenu({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useTranslation("home");
  return (
    <Menu>
      <Menu.Trigger
        render={<Button variant="ghost" size="icon-sm" shape="pill" />}
        aria-label={t("study.collection.itemOptions", { text: label })}
      >
        <Icon icon={MoreHorizontalIcon} size={16} />
      </Menu.Trigger>
      <Menu.Content align="end">{children}</Menu.Content>
    </Menu>
  );
}

function HighlightItem({
  item,
  book,
  due,
  select,
  editing,
  setEditing,
  locate,
  discuss,
  openingPractice,
  remove,
}: {
  item: Highlight;
  book?: string;
  due: string;
  select: Selectable;
  editing: Highlight | null;
  setEditing: (item: Highlight | null) => void;
  locate: () => void;
  discuss: () => void;
  openingPractice: boolean;
  remove: () => void;
}) {
  const { t } = useTranslation(["home", "common"]);
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const preview = studyHighlightPreview(item.quote);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing || saving) return;
    const { id, note, cue, color } = editing;
    setSaving(true);
    try {
      const saved = await updateStudyReviewItem({ kind: "highlight", id, change: { note, cue, color }, updatedAt: Date.now() });
      if (!saved) toast.error(t("study.recall.editUnavailable"));
      setEditing(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  function saveToNotes() {
    void saveStudyNote({
      title: t("study.collection.highlightNoteTitle"),
      body: [item.quote, item.note].filter(Boolean).join("\n\n"),
      notebookId: item.notebookId,
      origin: studyHighlightOrigin(item),
    })
      .then((note) =>
        toast.success(t("study.collection.savedToNotes"), {
          action: {
            label: t("study.collection.openNote"),
            onClick: () => navigate(originHref({ kind: "note", noteId: note.id })),
          },
        }),
      )
      .catch((error: Error) => toast.error(error.message));
  }

  return (
    <ItemShell
      kind={t("study.collection.kinds.highlight")}
      dot={highlightColors[item.color]}
      source={book}
      label={preview}
      select={select}
      due={due}
      actions={
        editing ? null : (
          <>
            <Button size="sm" variant="ghost" onClick={locate}>
              {t("study.collection.openInBook")}
            </Button>
            <Button size="sm" variant="ghost" disabled={openingPractice} onClick={discuss}>
              {t("study.collection.askAi")}
            </Button>
            <ItemMenu label={preview}>
              <Menu.Item onClick={() => setEditing(item)}>
                <Icon icon={PencilEdit01Icon} />
                {t("study.collection.editNote")}
              </Menu.Item>
              <Menu.Item onClick={saveToNotes}>
                <Icon icon={Note01Icon} />
                {t("study.collection.saveToNotes")}
              </Menu.Item>
              <Menu.Item variant="destructive" onClick={remove}>
                <Icon icon={Delete02Icon} />
                {t("study.collection.delete")}
              </Menu.Item>
            </ItemMenu>
          </>
        )
      }
    >
      <blockquote className="font-serif text-[0.9375rem] leading-relaxed wrap-break-word">
        <StudyText text={item.quote} />
      </blockquote>
      {editing ? (
        <form className="space-y-2" onSubmit={(event) => void save(event)}>
          <Input
            dir={textDirection(editing.cue ?? "")}
            aria-label={t("study.recall.cue")}
            placeholder={t("study.recall.cue")}
            value={editing.cue ?? ""}
            maxLength={240}
            onChange={(event) => setEditing({ ...editing, cue: event.target.value })}
          />
          <Textarea
            dir={textDirection(editing.note)}
            aria-label={t("study.collection.note")}
            placeholder={t("study.collection.note")}
            minRows={2}
            value={editing.note}
            onChange={(event) => setEditing({ ...editing, note: event.target.value })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={t("study.highlights.colorLabel")}
              className="h-8 rounded-lg border bg-background px-2 text-sm"
              value={editing.color}
              onChange={(event) => {
                const choice = studyHighlightColor.safeParse(event.target.value);
                if (choice.success) setEditing({ ...editing, color: choice.data });
              }}
            >
              {studyHighlightColor.options.map((name) => (
                <option key={name} value={name}>
                  {t(`study.highlights.colors.${name}`)}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" loading={saving}>
              {t("study.collection.saveHighlight")}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(null)}>
              {t("common:actions.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <>
          {item.cue ? <DirectionalText text={item.cue} className="text-sm font-medium" /> : null}
          {item.note ? (
            <DirectionalText
              multiline
              text={item.note}
              className="rounded-xl bg-muted/60 px-3 py-2 text-sm text-muted-foreground"
            />
          ) : null}
        </>
      )}
    </ItemShell>
  );
}

function CardItem({
  item,
  due,
  select,
  edit,
  practice,
  openingPractice,
  remove,
}: {
  item: Card;
  due: string;
  select: Selectable;
  edit: () => void;
  practice: () => void;
  openingPractice: boolean;
  remove: () => void;
}) {
  const { t } = useTranslation("home");
  return (
    <ItemShell
      kind={t("study.collection.kinds.card")}
      dot={kindDots.card}
      source={item.tags.join(", ")}
      label={item.front}
      select={select}
      due={due}
      actions={
        <>
          {item.origin ? <StudyOriginLink origin={item.origin} /> : null}
          <Button size="sm" variant="ghost" disabled={openingPractice} onClick={practice}>
            {t("study.collection.askAi")}
          </Button>
          <ItemMenu label={item.front}>
            <Menu.Item onClick={edit}>
              <Icon icon={PencilEdit01Icon} />
              {t("study.collection.edit")}
            </Menu.Item>
            <Menu.Item variant="destructive" onClick={remove}>
              <Icon icon={Delete02Icon} />
              {t("study.collection.delete")}
            </Menu.Item>
          </ItemMenu>
        </>
      }
    >
      <StudyText text={item.front} className="text-[0.9375rem] leading-snug font-semibold wrap-break-word" />
      {item.quizChoices?.length ? (
        <details className="text-sm">
          <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("study.recall.answerChoices")}
          </summary>
          <StudyCardChoices choices={item.quizChoices} showLabel={false} className="mt-2" />
        </details>
      ) : null}
      {item.image ? (
        <img className="max-h-24 rounded-lg object-contain" src={item.image} alt={t("study.collection.frontImage")} />
      ) : null}
      <StudyText text={item.back} className="line-clamp-4 text-sm leading-relaxed text-muted-foreground" />
      {item.backImage ? (
        <img className="max-h-24 rounded-lg object-contain" src={item.backImage} alt={t("study.collection.backImage")} />
      ) : null}
    </ItemShell>
  );
}

function WordItem({
  item,
  book,
  due,
  select,
  reviewable,
  opening,
  reviewWord,
  edit,
  remove,
  focused,
  ref,
}: {
  item: StudyWord;
  book?: string;
  due: string;
  select: Selectable;
  reviewable: boolean;
  opening: boolean;
  reviewWord: () => void;
  edit: () => void;
  remove: () => void;
  focused: boolean;
  ref?: Ref<HTMLElement>;
}) {
  const { t } = useTranslation("home");
  const origin = vocabularyOrigin(item);
  return (
    <ItemShell
      ref={ref}
      id={`study-word-${item.id}`}
      focused={focused}
      kind={t("study.collection.kinds.word")}
      dot={kindDots.word}
      source={book ?? item.language}
      label={item.term}
      select={select}
      due={due}
      actions={
        <>
          {origin ? <StudyOriginLink origin={origin} /> : null}
          {reviewable ? (
            <Button size="sm" variant="ghost" disabled={opening} onClick={reviewWord}>
              {t("study.vocabulary.reviewWord")}
            </Button>
          ) : null}
          <ItemMenu label={item.term}>
            <Menu.Item onClick={edit}>
              <Icon icon={PencilEdit01Icon} />
              {t("study.collection.edit")}
            </Menu.Item>
            <Menu.Item variant="destructive" onClick={remove}>
              <Icon icon={Delete02Icon} />
              {t("study.collection.delete")}
            </Menu.Item>
          </ItemMenu>
        </>
      }
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-serif text-2xl leading-tight font-medium wrap-break-word" dir={textDirection(item.term)}>
          {item.term}
        </p>
        <StudyListenButton text={item.term} className="-me-1 shrink-0" />
      </div>
      {item.translation ? (
        <p className="text-lg leading-snug wrap-break-word" dir={textDirection(item.translation)}>
          {item.translation}
        </p>
      ) : null}
      {item.context ? (
        <DirectionalText
          multiline
          text={item.context}
          className="line-clamp-3 font-serif text-sm text-muted-foreground italic"
        />
      ) : null}
      {item.note ? (
        <DirectionalText multiline text={item.note} className="text-sm text-muted-foreground" />
      ) : null}
      {item.examples?.length ? (
        <details className="text-sm text-muted-foreground">
          <summary className="w-fit cursor-pointer">
            {t("study.vocabulary.examples", { count: item.examples.length })}
          </summary>
          <ul className="mt-2 divide-y rounded-xl border px-3">
            {item.examples.map(({ context, origin: place }, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2 py-2">
                {context ? (
                  <DirectionalText multiline text={context} className="min-w-0 basis-full wrap-break-word" />
                ) : null}
                {place ? <StudyOriginLink origin={place} /> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </ItemShell>
  );
}

function loadCardImage(file: File, change: (value: string) => void, errors: { type: string; read: string }) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 2 * 1024 * 1024) {
    toast.error(errors.type);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") change(reader.result);
  };
  reader.onerror = () => toast.error(errors.read);
  reader.readAsDataURL(file);
}

function ImagePicker({
  label,
  image,
  change,
  errors,
}: {
  label: string;
  image?: string;
  change: (value?: string) => void;
  errors: { type: string; read: string };
}) {
  const { t } = useTranslation("home");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm">
        {label}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="mt-1 block"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) loadCardImage(file, change, errors);
            event.target.value = "";
          }}
        />
      </label>
      {image ? (
        <>
          <img src={image} className="size-12 rounded object-cover" alt={label} />
          <Button type="button" size="sm" variant="ghost" onClick={() => change(undefined)}>
            {t("study.collection.removeImage", { label })}
          </Button>
        </>
      ) : null}
    </div>
  );
}

function CardEditorDialog({
  editor,
  setEditor,
  creation,
}: {
  editor: CardEditor;
  setEditor: (update: (editor: CardEditor | null) => CardEditor | null) => void;
  creation: Pick<Card, "notebookId" | "origin" | "tags" | "vaultId"> | false;
}) {
  const { t } = useTranslation(["home", "common"]);
  const form = useId();
  const [saving, setSaving] = useState(false);
  const errors = { type: t("study.collection.imageType"), read: t("study.collection.imageError") };
  const change = (patch: Partial<CardEditor>) =>
    setEditor((current) => (current && current.id === editor.id ? { ...current, ...patch } : current));

  function pasteImage(event: ClipboardEvent<HTMLTextAreaElement>, side: "image" | "backImage") {
    const image = [...event.clipboardData.files].find((file) => file.type.startsWith("image/"));
    if (!image) return;
    event.preventDefault();
    loadCardImage(image, (value) => change({ [side]: value }), errors);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor.front.trim() || !editor.back.trim() || saving) return;
    const content = {
      front: editor.front.trim(),
      back: editor.back.trim(),
      tags: [...new Set(editor.tags.map((tag) => tag.trim()).filter(Boolean))],
      quizChoices: editor.quizChoices,
      image: editor.image,
      backImage: editor.backImage,
    };
    setSaving(true);
    try {
      if (editor.mode === "create") {
        if (!creation) return;
        await saveStudyCard({ ...creation, ...content }, editor.id);
      } else {
        const saved = await updateStudyReviewItem({ kind: "card", id: editor.id, change: content, updatedAt: Date.now() });
        if (!saved) {
          toast.error(t("study.recall.editUnavailable"));
          return;
        }
      }
      setEditor(() => null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && setEditor(() => null)}>
      <Dialog.Content closeLabel={t("common:actions.close")}>
        <Dialog.Header title={t(editor.mode === "create" ? "study.collection.newCard" : "study.collection.editCard")} />
        <Dialog.Body>
          <form id={form} className="grid gap-3" onSubmit={(event) => void save(event)}>
            <label className="grid gap-1.5 text-sm font-medium">
              {t("study.collection.front")}
              <Textarea
                dir={textDirection(editor.front)}
                required
                minRows={2}
                value={editor.front}
                onChange={(event) => change({ front: event.target.value })}
                onPaste={(event) => pasteImage(event, "image")}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t("study.collection.back")}
              <Textarea
                dir={textDirection(editor.back)}
                required
                minRows={3}
                value={editor.back}
                onChange={(event) => change({ back: event.target.value })}
                onPaste={(event) => pasteImage(event, "backImage")}
              />
            </label>
            {editor.quizChoices?.length ? (
              <div className="space-y-2 rounded-lg border p-3">
                <StudyCardChoices choices={editor.quizChoices} />
                <Button type="button" size="sm" variant="outline" onClick={() => change({ quizChoices: [] })}>
                  {t("study.recall.removeAnswerChoices")}
                </Button>
              </div>
            ) : null}
            <label className="grid gap-1.5 text-sm font-medium">
              {t("study.collection.tags")}
              <Input
                placeholder={t("study.collection.tagsPlaceholder")}
                value={editor.tags.join(",")}
                onChange={(event) => change({ tags: event.target.value.split(",") })}
              />
            </label>
            <ImagePicker
              label={t("study.collection.frontImage")}
              image={editor.image}
              change={(image) => change({ image })}
              errors={errors}
            />
            <ImagePicker
              label={t("study.collection.backImage")}
              image={editor.backImage}
              change={(backImage) => change({ backImage })}
              errors={errors}
            />
          </form>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close render={<Button variant="secondary" disabled={saving} />}>
            {t("common:actions.cancel")}
          </Dialog.Close>
          <Button type="submit" form={form} loading={saving} disabled={!editor.front.trim() || !editor.back.trim()}>
            {t("study.collection.saveCard")}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}

const wordFields = ["term", "translation", "language", "context", "note"] as const;

function WordEditorDialog({
  editor,
  setEditor,
  vaultId,
}: {
  editor: { mode: "add" | "edit"; word: StudyWord };
  setEditor: (update: (editor: { mode: "add" | "edit"; word: StudyWord } | null) => typeof editor | null) => void;
  vaultId: string;
}) {
  const { t } = useTranslation(["home", "common"]);
  const form = useId();
  const [saving, setSaving] = useState(false);
  const { word, mode } = editor;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!word.term.trim() || saving) return;
    setSaving(true);
    try {
      if (mode === "edit") await updateStudyWord(word, vaultId);
      else await saveStudyWord({ ...word, vaultId }, word.id);
      setEditor(() => null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && setEditor(() => null)}>
      <Dialog.Content closeLabel={t("common:actions.close")}>
        <Dialog.Header title={t(mode === "add" ? "study.collection.newWord" : "study.collection.editWord")} />
        <Dialog.Body>
          <form id={form} className="grid gap-3" onSubmit={(event) => void save(event)}>
            {wordFields.map((name) => (
              <label key={name} className="grid gap-1.5 text-sm font-medium">
                {t(`study.collection.wordFields.${name}`)}
                <Input
                  dir={textDirection(word[name])}
                  value={word[name]}
                  disabled={saving}
                  required={name === "term"}
                  onChange={(event) => {
                    const value = event.target.value;
                    setEditor((current) => current && { ...current, word: { ...current.word, [name]: value } });
                  }}
                />
              </label>
            ))}
          </form>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close render={<Button variant="secondary" disabled={saving} />}>
            {t("common:actions.cancel")}
          </Dialog.Close>
          <Button type="submit" form={form} loading={saving} disabled={!word.term.trim()}>
            {t("study.collection.saveWord")}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
