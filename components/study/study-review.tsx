import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { DirectionalText } from "@/components/common/directional-text";
import { textDirection } from "@/lib/text/direction";
import { StudyFlashcardGenerator } from "./study-flashcard-generator";
import { StudyOriginLink } from "./study-origin-link";
import {
  originHref,
  studyCitationOrigin,
  studyHighlightOrigin,
  studyHref,
} from "@/lib/study/links";
import { studyHighlightPreview } from "@/lib/study/recall";
import {
  loadReviewSession,
  resumeReviewSnapshot,
  reviewQueue,
  reviewReturnState,
  reviewSelection,
  saveReviewCheckpoint,
  saveReviewSession,
  type ReviewSnapshot,
} from "@/lib/study/review-session";
import { toast } from "sonner";
import { Button } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import {
  freshSchedule,
  putStudyRecords,
  rateStudyItem,
  saveStudyNote,
  removeStudyRecord,
  studyId,
} from "@/lib/db/study";
import { scheduleState, studyIntervalLabel } from "@/lib/study/schedule";
import { vocabularyOrigin } from "@/lib/study/vocabulary";
import {
  studyRatings,
  type StudyBook,
  type StudyRating,
  type StudyRecordOf,
  type StudyThread,
} from "@/lib/study/records";

type Card = StudyRecordOf<"card">;
type Highlight = StudyRecordOf<"highlight">;
type Word = StudyRecordOf<"word">;
const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const textArea = "min-h-20 w-full rounded-xl border bg-background p-3 text-sm";

function useReviewClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, []);
  return now;
}

export function StudyReview({
  items,
  useHighlights,
  books,
  words,
  threads,
  practice,
  openingPractice,
  collection,
  initialPractice,
  vaultId,
  libraryHref,
  libraryLabel,
  ratedInDatabase,
  sessionId,
}: {
  items: (Card | Highlight)[];
  useHighlights: boolean;
  books: StudyBook[];
  words: Word[];
  threads: StudyThread[];
  practice: (item: Card | Highlight, state: ReturnType<typeof reviewReturnState>) => void;
  openingPractice: boolean;
  collection?: string;
  initialPractice?: boolean;
  vaultId: string;
  libraryHref?: string;
  libraryLabel?: string;
  ratedInDatabase: number;
  sessionId: string;
}) {
  const { t } = useTranslation("home");
  const now = useReviewClock();
  const location = useLocation();
  const path = location.pathname + location.search;
  const destination = useMemo(() => {
    const selection = reviewSelection(location.state);
    return {
      path,
      state: {
        ...selection,
        studyReviewSession: sessionId,
        studyReviewVault: vaultId,
      },
    };
  }, [location.state, path, vaultId, sessionId]);
  const storageId = JSON.stringify([sessionId, path, vaultId]);
  const [session, setSession] = useState(
    () =>
      resumeReviewSnapshot(vaultId, destination) ??
      loadReviewSession(storageId) ?? {
        revealed: "",
        rated: 0,
        practiced: initialPractice ? [] : null,
      },
  );
  const { revealed, practiced, position } = session;
  const rated = Math.max(session.rated, ratedInDatabase);
  const [started, setStarted] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState<ReviewSnapshot["position"]>();
  const answer = useRef<HTMLDivElement>(null);
  const reveal = useRef<HTMLButtonElement>(null);
  const grading = useRef(false);
  const queue = reviewQueue(items, practiced, now).filter(
    ({ id, schedule }) => practiced || id !== finished?.id || schedule.dueAt !== finished.dueAt,
  );
  const pinned = queue.find(({ id, schedule }) =>
    position
      ? id === position.id && (practiced || schedule.dueAt === position.dueAt)
      : id === revealed,
  );
  const item = pinned ?? queue[0];
  const remaining = items.toSorted((a, b) => a.schedule.dueAt - b.schedule.dueAt)[0];
  const isRevealed = Boolean(item && revealed === item.id && (!position || pinned));
  const highlightBook =
    item?.kind === "highlight" ? books.find(({ id }) => id === item.bookId) : undefined;

  function revealAnswer() {
    if (item)
      setSession((value) => ({
        ...value,
        revealed: item.id,
        position: { id: item.id, dueAt: item.schedule.dueAt },
      }));
  }

  async function grade(rating: StudyRating, gradedAt: number) {
    if (!item || practiced || grading.current) return;
    grading.current = true;
    setBusy(true);
    try {
      const dueAt = item.schedule.dueAt;
      const committed = await rateStudyItem(item.id, rating, (gradedAt - started) / 1000, {
        sessionId,
        dueAt,
      });
      setFinished({ id: item.id, dueAt });
      setSession((value) => ({
        ...value,
        revealed: "",
        position: undefined,
        rated: Math.max(rated, value.rated) + (committed ? 1 : 0),
      }));
      setStarted(gradedAt);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      grading.current = false;
      setBusy(false);
    }
  }

  const itemId = item?.id;
  const dueAt = item?.schedule.dueAt;
  useLayoutEffect(() => {
    const snapshot = {
      revealed: isRevealed ? revealed : "",
      rated,
      practiced,
      position: itemId && dueAt !== undefined ? { id: itemId, dueAt } : undefined,
    };
    saveReviewSession(storageId, snapshot);
    saveReviewCheckpoint(vaultId, destination, snapshot);
  }, [isRevealed, revealed, rated, practiced, itemId, dueAt, storageId, vaultId, destination]);

  useLayoutEffect(() => {
    const target = isRevealed ? answer.current : reveal.current;
    target?.focus({ preventScroll: true });
  }, [isRevealed, item?.id]);

  function keydown(event: KeyboardEvent) {
    if (!item || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.repeat)
      return;
    if (event.key === " " && !isRevealed) {
      if (event.target instanceof HTMLElement && event.target.closest("button, a")) return;
      event.preventDefault();
      revealAnswer();
    }
    const rating = studyRatings[Number(event.key) - 1];
    if (rating && isRevealed && !practiced) {
      event.preventDefault();
      void grade(rating, performance.timeOrigin + event.timeStamp);
    }
  }

  const origin = item?.kind === "highlight" ? studyHighlightOrigin(item) : item?.origin;
  const word = origin?.kind === "word" ? words.find(({ id }) => id === origin.wordId) : undefined;
  const wordOrigin = word && vocabularyOrigin(word);
  const message =
    origin?.kind === "tutor" && origin.message !== undefined
      ? threads.find(({ id }) => id === origin.threadId)?.messages[origin.message]
      : undefined;
  const citations = message?.role === "assistant" ? (message.citations ?? []) : [];
  const returnState = { studyReturn: destination };

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">
          {useHighlights ? "Review highlights" : "Review flashcards"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {practiced
            ? t("study.recall.practiceRemaining", { count: queue.length })
            : `${queue.length} due · ${rated} reviewed this session`}
          {collection ? ` · ${collection}` : ""}
        </p>
      </div>
      {item ? (
        <div
          className="max-w-2xl space-y-4 rounded-2xl border bg-card p-4 sm:p-6"
          onKeyDown={keydown}
        >
          {highlightBook ? (
            <p className="text-sm text-muted-foreground" dir="auto">
              {highlightBook.title} ·{" "}
              {highlightBook.sections[item.kind === "highlight" ? item.section : 0]?.title}
            </p>
          ) : null}
          <DirectionalText
            multiline
            text={
              item.kind === "card" ? item.front : item.cue || "Recall why you saved this passage."
            }
            className="text-xl font-medium wrap-break-word whitespace-pre-wrap"
          />
          {item.kind === "card" && item.image ? (
            <img
              className="max-h-52 rounded-lg object-contain"
              src={item.image}
              alt="Flashcard attachment"
            />
          ) : null}
          {!isRevealed ? (
            <Button ref={reveal} onClick={revealAnswer}>
              Show answer
            </Button>
          ) : (
            <div ref={answer} tabIndex={-1} className="space-y-3 outline-none">
              <DirectionalText
                multiline
                text={item.kind === "card" ? item.back : item.quote}
                className="border-t pt-4 wrap-break-word whitespace-pre-wrap"
              />
              {item.kind === "card" && item.backImage ? (
                <img
                  className="max-h-52 rounded-lg object-contain"
                  src={item.backImage}
                  alt="Answer attachment"
                />
              ) : null}
              {item.kind === "highlight" && item.note ? (
                <DirectionalText
                  multiline
                  text={item.note}
                  className="text-sm text-muted-foreground"
                />
              ) : null}
              {origin && !busy ? <StudyOriginLink origin={origin} state={returnState} /> : null}
              {wordOrigin && !busy ? <StudyOriginLink origin={wordOrigin} state={returnState} /> : null}
              {citations.length && !busy ? (
                <div>
                  <p className="text-sm text-muted-foreground">{t("study.capture.tutorAnswerSources")}</p>
                  <div className="flex flex-wrap gap-1">
                    {citations.map((citation) => (
                      <StudyOriginLink
                        key={citation.index}
                        origin={studyCitationOrigin(citation)}
                        label={`[${citation.index}] ${citation.title}`}
                        state={returnState}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                disabled={busy || openingPractice}
                onClick={() => practice(item, returnState)}
              >
                {t(item.kind === "card" ? "study.recall.tutorCardAction" : "study.highlights.discussOne")}
              </Button>
              {practiced ? (
                <Button
                  onClick={() => {
                    setSession((value) => ({
                      ...value,
                      practiced: [...practiced, item.id],
                      revealed: "",
                      position: undefined,
                    }));
                  }}
                >
                  {t("study.recall.nextPractice")}
                </Button>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {studyRatings.map((rating, index) => (
                    <Button
                      key={rating}
                      variant={rating === "good" ? "default" : "outline"}
                      className="capitalize"
                      disabled={busy}
                      onClick={() => void grade(rating, Date.now())}
                      aria-keyshortcuts={String(index + 1)}
                      aria-label={rating}
                    >
                      {rating}
                      <span className="ms-1 text-xs normal-case opacity-75">
                        {studyIntervalLabel(item.schedule, rating)}
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3 rounded-2xl border bg-muted/25 p-5 text-sm text-muted-foreground">
          <p>
            {practiced ? (
              t("study.recall.practiceComplete", { count: practiced.length })
            ) : (
              <>
                {rated > 0 ? `Reviewed ${rated} this session. ` : ""}
                {remaining
                  ? `You’re caught up. Next review ${date.format(remaining.schedule.dueAt)}.`
                  : "Add something to study first."}
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {items.length ? (
              <Button
                variant="outline"
                onClick={() =>
                  setSession((value) => ({
                    ...value,
                    practiced: [],
                    revealed: "",
                    position: undefined,
                  }))
                }
              >
                {t("study.recall.practiceNow")}
              </Button>
            ) : null}
            <Link
              to={libraryHref ?? studyHref(useHighlights ? "highlights" : "cards")}
              className="underline underline-offset-4"
            >
              {libraryLabel ?? (useHighlights ? "Open highlights" : "Open flashcards")}
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

function loadCardImage(file: File, change: (value: string) => void) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 2 * 1024 * 1024) {
    toast.error("Choose a PNG, JPEG, WebP, or GIF under 2 MB.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") change(reader.result);
  };
  reader.onerror = () => toast.error("Could not open that image.");
  reader.readAsDataURL(file);
}

function ImagePicker({
  label,
  image,
  change,
}: {
  label: string;
  image?: string;
  change: (value?: string) => void;
}) {
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
            if (file) loadCardImage(file, change);
            event.target.value = "";
          }}
        />
      </label>
      {image ? (
        <>
          <img src={image} className="h-12 w-12 rounded object-cover" alt={label} />
          <Button type="button" size="sm" variant="ghost" onClick={() => change(undefined)}>
            Remove {label.toLowerCase()}
          </Button>
        </>
      ) : null}
    </div>
  );
}

export function CardLibrary({
  cards,
  vaultId,
  filter,
  clearFilter,
  review,
  practice,
  openingPractice,
  creation,
}: {
  cards: Card[];
  vaultId: string;
  filter?: string;
  clearFilter: () => void;
  review: (ids?: string[]) => void;
  practice: (ids: string[]) => void;
  openingPractice: boolean;
  creation: Pick<Card, "notebookId" | "origin" | "tags" | "vaultId"> | false;
}) {
  const { t } = useTranslation("home");
  const now = useReviewClock();
  const [generating, setGenerating] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Card | null>(null);
  const [deleting, setDeleting] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState("all");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("recent");
  const [view, setView] = useState<"list" | "grid">("list");
  const [flipped, setFlipped] = useState<string>();
  const [saving, setSaving] = useState(false);
  const tags = [...new Set(cards.flatMap((card) => card.tags))].sort();
  const selectedCards = cards.filter((card) => selected.includes(card.id));
  const cardsShown = cards
    .filter((card) => {
      const matched = [card.front, card.back, ...card.tags]
        .join(" ")
        .toLowerCase()
        .includes(query.trim().toLowerCase());
      return (
        matched &&
        (!tag || card.tags.includes(tag)) &&
        (status === "all" ||
          (status === "due" ? card.schedule.dueAt <= now : scheduleState(card.schedule) === status))
      );
    })
    .sort((a, b) => {
      if (sort === "due") return a.schedule.dueAt - b.schedule.dueAt;
      if (sort === "question") return a.front.localeCompare(b.front);
      return b.updatedAt - a.updatedAt;
    });
  const allShownSelected =
    cardsShown.length > 0 && cardsShown.every((card) => selected.includes(card.id));
  const reviewSet = selectedCards.length ? selectedCards : cardsShown;

  function changeImage(side: "image" | "backImage", value?: string) {
    const editingId = editing?.id;
    setEditing((card) => (card && card.id === editingId ? { ...card, [side]: value } : card));
  }

  function pasteImage(event: ClipboardEvent<HTMLTextAreaElement>, side: "image" | "backImage") {
    const image = [...event.clipboardData.files].find((file) => file.type.startsWith("image/"));
    if (!image) return;
    event.preventDefault();
    loadCardImage(image, (value) => changeImage(side, value));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing?.front.trim() || !editing.back.trim()) return;
    setSaving(true);
    try {
      await putStudyRecords({
        ...editing,
        front: editing.front.trim(),
        back: editing.back.trim(),
        tags: [...new Set(editing.tags.map((tag) => tag.trim()).filter(Boolean))],
        schedule: cards.find(({ id }) => id === editing.id)?.schedule ?? editing.schedule,
        updatedAt: Date.now(),
      });
      setEditing(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap justify-between gap-2">
        <h2 className="text-xl font-semibold">Flashcards</h2>
        <div className="flex flex-wrap gap-2">
          {selectedCards.length ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  const text = selectedCards
                    .map((card) => `Q: ${card.front}\nA: ${card.back}`)
                    .join("\n\n");
                  void navigator.clipboard
                    .writeText(text)
                    .then(() => toast.success("Flashcards copied"))
                    .catch(() => toast.error("Could not copy flashcards"));
                }}
              >
                Copy selection
              </Button>
              <Button
                variant="outline"
                onClick={() => setDeleting(selectedCards.map((card) => card.id))}
              >
                Delete selected ({selectedCards.length})
              </Button>
            </>
          ) : null}
          <Button
            variant="outline"
            onClick={() =>
              review(reviewSet.length === cards.length ? undefined : reviewSet.map(({ id }) => id))
            }
            disabled={!reviewSet.length}
          >
            {selectedCards.length
              ? t("study.recall.reviewSelected", { count: selectedCards.length })
              : "Review these cards"}
          </Button>
          {reviewSet.length ? (
            <Button
              variant="outline"
              disabled={openingPractice}
              onClick={() => practice(reviewSet.map(({ id }) => id))}
            >
              {t("study.recall.tutorAction")}
            </Button>
          ) : null}
          {!filter && !generating ? (
            <Button variant="outline" onClick={() => setGenerating(true)}>
              Generate from text
            </Button>
          ) : null}
          {creation === false ? null : (
            <Button
              onClick={() =>
                setEditing({
                  id: studyId(),
                  kind: "card",
                  front: "",
                  back: "",
                  ...creation,
                  updatedAt: Date.now(),
                  schedule: freshSchedule(),
                })
              }
            >
              New flashcard
            </Button>
          )}
        </div>
      </div>
      {generating && !filter ? (
        <StudyFlashcardGenerator close={() => setGenerating(false)} vaultId={vaultId} />
      ) : null}
      {filter ? <FilterCaption label={filter} clear={clearFilter} /> : null}
      {editing ? (
        <form
          onSubmit={(event) => void save(event)}
          className="grid max-w-2xl gap-3 rounded-2xl border p-4"
        >
          <textarea
            className={textArea}
            dir={textDirection(editing.front)}
            aria-label="Front"
            placeholder="Front"
            required
            value={editing.front}
            onChange={(event) => setEditing({ ...editing, front: event.target.value })}
            onPaste={(event) => pasteImage(event, "image")}
          />
          <textarea
            className={textArea}
            dir={textDirection(editing.back)}
            aria-label="Back"
            placeholder="Back"
            required
            value={editing.back}
            onChange={(event) => setEditing({ ...editing, back: event.target.value })}
            onPaste={(event) => pasteImage(event, "backImage")}
          />
          <Input
            aria-label="Tags"
            placeholder="Tags, separated by commas"
            value={editing.tags.join(",")}
            onChange={(event) => setEditing({ ...editing, tags: event.target.value.split(",") })}
          />
          <ImagePicker
            label="Front image"
            image={editing.image}
            change={(image) => changeImage("image", image)}
          />
          <ImagePicker
            label="Back image"
            image={editing.backImage}
            change={(image) => changeImage("backImage", image)}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              Save flashcard
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Input
          type="search"
          placeholder="Search flashcards"
          aria-label="Search flashcards"
          className="max-w-xs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="Filter flashcards"
          className="rounded-lg border bg-background px-2 text-sm"
        >
          <option value="all">All cards</option>
          <option value="due">Due</option>
          <option value="new">New</option>
          <option value="learning">Learning</option>
          <option value="reviewing">Reviewing</option>
          <option value="mature">Mature</option>
        </select>
        {tags.length ? (
          <select
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            aria-label="Filter by tag"
            className="rounded-lg border bg-background px-2 text-sm"
          >
            <option value="">All tags</option>
            {tags.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        ) : null}
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value)}
          aria-label="Sort flashcards"
          className="rounded-lg border bg-background px-2 text-sm"
        >
          <option value="recent">Recently updated</option>
          <option value="due">Next review</option>
          <option value="question">Question</option>
        </select>
        <div className="flex gap-1" role="group" aria-label="Flashcard layout">
          {(["list", "grid"] as const).map((mode) => (
            <Button
              key={mode}
              size="sm"
              variant={view === mode ? "secondary" : "ghost"}
              aria-pressed={view === mode}
              onClick={() => setView(mode)}
            >
              {mode === "list" ? "List" : "Grid"}
            </Button>
          ))}
        </div>
      </div>
      {cardsShown.length ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allShownSelected}
            onChange={(event) => {
              const checked = event.target.checked;
              const shown = new Set(cardsShown.map(({ id }) => id));
              setSelected((ids) =>
                checked ? [...new Set([...ids, ...shown])] : ids.filter((id) => !shown.has(id)),
              );
            }}
          />
          Select shown cards
        </label>
      ) : null}
      <ul
        className={
          view === "grid"
            ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
            : "divide-y rounded-2xl border"
        }
      >
        {cardsShown.map((card) => (
          <li
            key={card.id}
            className={
              view === "grid"
                ? "grid content-start gap-3 rounded-2xl border bg-card p-4"
                : "flex flex-wrap items-center gap-3 p-4"
            }
          >
            <input
              type="checkbox"
              aria-label={`Select ${card.front}`}
              checked={selected.includes(card.id)}
              onChange={(event) =>
                setSelected(
                  event.target.checked
                    ? [...selected, card.id]
                    : selected.filter((id) => id !== card.id),
                )
              }
            />
            <div className="min-w-0 flex-1">
              <DirectionalText text={card.front} className="font-medium wrap-break-word" />
              {card.image ? (
                <img
                  className="my-2 max-h-20 rounded object-contain"
                  src={card.image}
                  alt="Question attachment"
                />
              ) : null}
              {view === "list" || flipped === card.id ? (
                <>
                  <DirectionalText
                    text={card.back}
                    className="line-clamp-2 text-sm text-muted-foreground"
                  />
                  {card.backImage ? (
                    <img
                      className="my-2 max-h-20 rounded object-contain"
                      src={card.backImage}
                      alt="Answer attachment"
                    />
                  ) : null}
                </>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {card.schedule.dueAt <= now ? "Due now" : date.format(card.schedule.dueAt)}
                {card.tags.length ? ` · ${card.tags.join(", ")}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {view === "grid" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setFlipped(flipped === card.id ? undefined : card.id)}
                >
                  {flipped === card.id ? "Hide answer" : "Show answer"}
                </Button>
              ) : null}
              {card.origin ? <StudyOriginLink origin={card.origin} /> : null}
              <Button size="sm" variant="ghost" onClick={() => setEditing(card)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDeleting([card.id])}>
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {!cardsShown.length ? (
        <p className="text-sm text-muted-foreground">No flashcards match.</p>
      ) : null}
      <ConfirmDialog
        open={deleting.length > 0}
        onOpenChange={(open) => {
          if (!open) setDeleting([]);
        }}
        title="Delete flashcards?"
        body="The selected cards will be removed from your study library."
        confirmLabel="Delete"
        onConfirm={async () => {
          const ids = [...deleting];
          await Promise.all(ids.map(removeStudyRecord));
          setSelected((value) => value.filter((id) => !ids.includes(id)));
          setDeleting([]);
        }}
      />
    </section>
  );
}

function FilterCaption({ label, clear }: { label: string; clear: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span dir="auto">{label}</span>
      <Button variant="ghost" size="sm" onClick={clear}>
        Show all
      </Button>
    </div>
  );
}

export function HighlightsLibrary({
  highlights,
  filter,
  clearFilter,
  locate,
  review,
  discuss,
  openingTutor,
}: {
  highlights: Highlight[];
  filter?: string;
  clearFilter: () => void;
  locate: (item: Highlight) => void;
  review: (ids?: string[]) => void;
  discuss: (ids: string[]) => void;
  openingTutor: boolean;
}) {
  const { t } = useTranslation("home");
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Highlight | null>(null);
  const [deleting, setDeleting] = useState<Highlight | null>(null);
  const search = query.trim().toLowerCase();
  const visible = highlights.filter(({ quote, note, cue }) =>
    `${quote} ${note} ${cue ?? ""}`.toLowerCase().includes(search),
  );
  const selectedIds = new Set(selected);
  const checked = highlights.filter(({ id }) => selectedIds.has(id));
  const targetIds = (checked.length ? checked : visible).map(({ id }) => id);
  const narrowed = !!(checked.length || search);
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap justify-between gap-2">
        <h2 className="text-xl font-semibold">Highlights</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => discuss(targetIds)}
            disabled={!targetIds.length || openingTutor}
          >
            {targetIds.length
              ? t("study.highlights.discuss", { count: targetIds.length })
              : t("study.highlights.tutorTitle")}
          </Button>
          <Button onClick={() => review(narrowed ? targetIds : undefined)} disabled={!targetIds.length}>
            {narrowed ? t("study.highlights.reviewSelected", { count: targetIds.length }) : t("study.highlights.review")}
          </Button>
        </div>
      </div>
      {filter ? <FilterCaption label={filter} clear={clearFilter} /> : null}
      <Input
        type="search"
        aria-label="Search highlights"
        placeholder="Search highlights"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul className="space-y-3">
        {visible.map((item) => (
            <li key={item.id} className="space-y-2 rounded-2xl border p-4">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1 accent-primary"
                  aria-label={t("study.highlights.select", { text: studyHighlightPreview(item.quote) })}
                  checked={selectedIds.has(item.id)}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setSelected((ids) => checked ? [...ids, item.id] : ids.filter((id) => id !== item.id));
                  }}
                />
                <DirectionalText
                  as="blockquote"
                  text={item.quote}
                  className="min-w-0 font-medium wrap-break-word"
                />
              </div>
              {editing?.id === item.id ? (
                <form
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void putStudyRecords({ ...editing, updatedAt: Date.now() })
                      .then(() => setEditing(null))
                      .catch((error: Error) => toast.error(error.message));
                  }}
                >
                  <Input
                    dir={textDirection(editing.cue ?? "")}
                    aria-label={t("study.recall.cue")}
                    placeholder={t("study.recall.cue")}
                    value={editing.cue ?? ""}
                    maxLength={240}
                    onChange={(event) => setEditing({ ...editing, cue: event.target.value })}
                  />
                  <textarea
                    dir={textDirection(editing.note)}
                    className={textArea}
                    aria-label="Highlight note"
                    value={editing.note}
                    onChange={(event) => setEditing({ ...editing, note: event.target.value })}
                  />
                  <select
                    aria-label="Highlight color"
                    className="rounded-lg border bg-background p-2"
                    value={editing.color}
                    onChange={(event) =>
                      setEditing({ ...editing, color: event.target.value as Highlight["color"] })
                    }
                  >
                    {["yellow", "green", "blue", "pink"].map((color) => (
                      <option key={color}>{color}</option>
                    ))}
                  </select>
                  <Button type="submit" size="sm">
                    Save highlight
                  </Button>
                </form>
              ) : (
                <>
                  {item.cue ? (
                    <DirectionalText text={item.cue} className="text-sm font-medium" />
                  ) : null}
                  {item.note ? (
                    <DirectionalText
                      multiline
                      text={item.note}
                      className="text-sm text-muted-foreground"
                    />
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => locate(item)}>
                      Go to passage
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void saveStudyNote({
                          title: "Reading highlight",
                          body: [item.quote, item.note].filter(Boolean).join("\n\n"),
                          notebookId: item.notebookId,
                          origin: studyHighlightOrigin(item),
                        })
                          .then((note) =>
                            toast.success("Saved to Notes", {
                              action: {
                                label: "Open note",
                                onClick: () =>
                                  navigate(originHref({ kind: "note", noteId: note.id })),
                              },
                            }),
                          )
                          .catch((error: Error) => toast.error(error.message));
                      }}
                    >
                      Save to Notes
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(item)}>
                      Edit note
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(item)}>
                      Delete
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
      </ul>
      {!visible.length ? (
        <p className="text-sm text-muted-foreground">
          {t(highlights.length ? "study.highlights.noMatches" : "study.highlights.empty")}
        </p>
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete highlight?"
        body="Its note and review schedule will be removed."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleting) await removeStudyRecord(deleting.id);
          setDeleting(null);
        }}
      />
    </section>
  );
}
