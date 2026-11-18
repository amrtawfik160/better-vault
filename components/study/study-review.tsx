import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { DirectionalText } from "@/components/common/directional-text";
import { textDirection } from "@/lib/text/direction";
import { StudyCardChoices } from "./study-card-choices";
import { StudyCardImage } from "./study-card-image";
import { StudyFlashcardGenerator } from "./study-flashcard-generator";
import { StudyFlashcardDrafts } from "./study-flashcard-drafts";
import { StudyOriginLink } from "./study-origin-link";
import { StudyText } from "./study-text";
import { highlightColors } from "./study-highlight-colors";
import {
  originHref,
  studyCitationOrigin,
  studyHighlightOrigin,
  studyHref,
} from "@/lib/study/links";
import { difficultStudyItems, studyHighlightPreview } from "@/lib/study/recall";
import { quizChoiceLabel, quizChoicesText } from "@/lib/study/quiz-cards";
import {
  loadReviewSession,
  maxReviewResponseLength,
  pendingReviewLearning,
  resumeReviewSnapshot,
  reviewQueue,
  reviewReturnState,
  reviewSelection,
  saveReviewCheckpoint,
  saveReviewSession,
  type ReviewResponse,
  type ReviewSnapshot,
  type ReviewTutorFeedback,
} from "@/lib/study/review-session";
import { toast } from "sonner";
import { Button } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import { Textarea } from "@/components/panelui/textarea";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import {
  rateStudyItem,
  saveStudyCard,
  saveStudyNote,
  removeStudyRecord,
  studyId,
  updateStudyReviewItem,
} from "@/lib/db/study";
import { scheduleState, studyIntervalLabel } from "@/lib/study/schedule";
import { vocabularyOrigin } from "@/lib/study/vocabulary";
import {
  studyHighlightColor,
  studyRatings,
  type StudyBook,
  type StudyCardEdit,
  type StudyHighlightColor,
  type StudyRating,
  type StudyRecordOf,
  type StudyThread,
} from "@/lib/study/records";
import { useStudyClock } from "./use-study-clock";

type Card = StudyRecordOf<"card">;
type Highlight = StudyRecordOf<"highlight">;
type Word = StudyRecordOf<"word">;
type CardEditor = StudyCardEdit & { id: string; mode: "create" | "edit" };
const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const textArea = "min-h-20 w-full rounded-xl border bg-background p-3 text-sm";

function RetryCountdown({ dueAt }: { dueAt: number }) {
  const { t, i18n } = useTranslation("home");
  const now = useStudyClock([], 1000);
  const seconds = Math.max(0, Math.ceil((dueAt - now) / 1000));
  const minutes = Math.floor(seconds / 60).toLocaleString(i18n.language);
  const remainder = (seconds % 60).toLocaleString(i18n.language, { minimumIntegerDigits: 2 });
  return (
    <p role="timer" className="font-medium text-foreground tabular-nums">
      {t("study.recall.learningCountdown", { time: `${minutes}:${remainder}` })}
    </p>
  );
}

export function StudyReview({
  items,
  useHighlights,
  books,
  words,
  threads,
  practice,
  practiceDifficult,
  openingPractice,
  collection,
  initialPractice,
  vaultId,
  libraryHref,
  libraryLabel,
  studioReturn,
  history,
  sessionId,
}: {
  items: (Card | Highlight)[];
  useHighlights: boolean;
  books: StudyBook[];
  words: Word[];
  threads: StudyThread[];
  practice: (item: Card | Highlight, state: ReturnType<typeof reviewReturnState>, feedback?: ReviewTutorFeedback) => void;
  practiceDifficult: (ids: string[]) => void;
  openingPractice: boolean;
  collection?: string;
  initialPractice?: boolean;
  vaultId: string;
  libraryHref?: string;
  libraryLabel?: string;
  studioReturn?: { href: string; label: string };
  history: StudyRecordOf<"session">[];
  sessionId: string;
}) {
  const { t } = useTranslation("home");
  const now = useStudyClock(items);
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
  const [session, setSession] = useState<ReviewSnapshot>(
    () =>
      resumeReviewSnapshot(vaultId, destination) ??
      loadReviewSession(storageId) ?? {
        revealed: "",
        rated: 0,
        practiced: initialPractice ? [] : null,
      },
  );
  const { revealed, practiced, position } = session;
  const rated = Math.max(
    session.rated,
    history.filter((review) => review.activity === "review" && review.reviewSessionId === sessionId)
      .length,
  );
  const [started, setStarted] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState<
    NonNullable<ReviewSnapshot["position"]> & { committed: boolean }
  >();
  const answer = useRef<HTMLDivElement>(null);
  const reveal = useRef<HTMLButtonElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const grading = useRef(false);
  const previewing = useRef<string | undefined>(undefined);
  const queue = reviewQueue(items, practiced, now).filter(
    ({ id, schedule }) => practiced || id !== finished?.id || schedule.dueAt !== finished.dueAt,
  );
  const pinned = queue.find(({ id, schedule }) =>
    position
      ? id === position.id && (practiced || schedule.dueAt === position.dueAt)
      : id === revealed,
  );
  const item = pinned ?? queue[0];
  const waiting = practiced ? [] : pendingReviewLearning(items, history, sessionId, now);
  const nextRetry = waiting[0];
  const awaitingHistory =
    finished?.committed &&
    items.some(({ id, schedule }) => id === finished.id && schedule.dueAt === finished.dueAt);
  const difficult = !item && rated && !practiced && !nextRetry && !busy && !awaitingHistory
    ? difficultStudyItems(items, history, sessionId)
    : [];
  const remaining = items.toSorted((a, b) => a.schedule.dueAt - b.schedule.dueAt)[0];
  const isRevealed = Boolean(item && revealed === item.id && (!position || pinned));
  const choices = item?.kind === "card" && item.quizChoices?.length ? item.quizChoices : undefined;
  const savedResponse = position && pinned ? session.response : undefined;
  const response = savedResponse?.kind === "choice"
    ? choices?.[savedResponse.index] ? savedResponse : undefined
    : choices ? undefined : savedResponse;
  const attemptedAnswer = response?.kind === "choice" ? choices?.[response.index] : response?.value.trim();
  const feedbackId = item && isRevealed && attemptedAnswer
    ? (session.feedbackId ?? `review-feedback:${JSON.stringify([vaultId, sessionId, item.id, item.schedule.dueAt])}`)
    : undefined;
  const hasFeedback = feedbackId !== undefined && threads.some((thread) => thread.id === feedbackId);
  const question = item?.kind === "card" ? item.front : item?.cue || t("study.recall.highlightPrompt");
  const highlightBook =
    item?.kind === "highlight" ? books.find(({ id }) => id === item.bookId) : undefined;

  function revealAnswer() {
    if (!item || busy || isRevealed) return;
    const feedbackId = attemptedAnswer ? `review-feedback:${studyId()}` : undefined;
    setSession((value) => ({
      ...value,
      revealed: item.id,
      position: { id: item.id, dueAt: item.schedule.dueAt },
      response,
      feedbackId,
    }));
  }

  function respond(next: ReviewResponse) {
    if (item && !busy && !isRevealed)
      setSession((value) => ({
        ...value,
        position: { id: item.id, dueAt: item.schedule.dueAt },
        response: next,
        feedbackId: undefined,
      }));
  }

  function previewImage(open: boolean) {
    previewing.current = open ? item?.id : undefined;
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
      setFinished({ id: item.id, dueAt, committed });
      setSession((value) => ({
        ...value,
        revealed: "",
        position: undefined,
        response: undefined,
        feedbackId: undefined,
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

  const nextItem = item ?? nextRetry;
  const activeId = item?.id;
  const itemId = nextItem?.id;
  const dueAt = nextItem?.schedule.dueAt;
  useLayoutEffect(() => {
    if (busy || awaitingHistory) return;
    const snapshot = {
      revealed: isRevealed ? revealed : "",
      rated,
      practiced,
      position: itemId && dueAt !== undefined ? { id: itemId, dueAt } : undefined,
      response,
      feedbackId,
    };
    saveReviewSession(storageId, snapshot);
    saveReviewCheckpoint(vaultId, destination, snapshot);
  }, [
    isRevealed, revealed, rated, practiced, itemId, dueAt, response, feedbackId, storageId, vaultId, destination,
    busy, awaitingHistory,
  ]);

  useLayoutEffect(() => {
    if (busy || awaitingHistory) return;
    const target = activeId ? isRevealed ? answer.current : reveal.current : status.current;
    target?.focus({ preventScroll: true });
  }, [isRevealed, activeId, busy, awaitingHistory]);

  function keydown(event: KeyboardEvent) {
    if (!item || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.repeat)
      return;
    if (previewing.current === item.id || event.nativeEvent.isComposing) return;
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return;
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
  const cardCitations = item?.kind === "card" ? item.citations : undefined;
  const citations = cardCitations ?? (message?.role === "assistant" ? (message.citations ?? []) : []);
  const library = libraryHref ?? studyHref(useHighlights ? "highlights" : "cards", { vault: vaultId });
  const libraryName = libraryLabel ?? (useHighlights ? "Open highlights" : "Open flashcards");
  const returnState = { studyReturn: destination };

  function openTutor() {
    if (!item) return;
    const responseText = attemptedAnswer?.slice(0, 10_000);
    const draftText = feedbackId && attemptedAnswer
      ? t(item.kind === "card" ? "study.recall.cardFeedbackPrompt" : "study.recall.highlightFeedbackPrompt", {
          cue: question.slice(0, 500),
          response: response?.kind === "choice"
            ? t("study.recall.feedbackChoice", { choice: quizChoiceLabel(response.index), response: responseText })
            : responseText,
        })
      : undefined;
    practice(item, returnState, draftText && feedbackId ? { threadId: feedbackId, text: draftText } : undefined);
  }

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
        {(item && libraryHref) || studioReturn ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {item && libraryHref ? (
              <Link to={library} className="underline underline-offset-4">
                {libraryName}
              </Link>
            ) : null}
            {studioReturn ? (
              <Link to={studioReturn.href} state={returnState} className="underline underline-offset-4">
                {studioReturn.label}
              </Link>
            ) : null}
          </div>
        ) : null}
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
          <StudyText text={question} className="text-xl font-medium wrap-break-word" />
          <StudyCardChoices choices={choices} selection={isRevealed ? undefined : {
            index: response?.kind === "choice" ? response.index : undefined,
            choose: (index) => respond({ kind: "choice", index }),
          }} />
          {item.kind === "card" && item.image ? (
            <StudyCardImage
              side="question"
              image={item.image}
              onOpenChange={previewImage}
            />
          ) : null}
          {!isRevealed ? (
            <>
              {!choices ? (
                <label className="grid gap-1.5 text-sm font-medium">
                  {t("study.recall.writeAnswer")}
                  <Textarea dir="auto" minRows={2} maxRows={5} maxLength={maxReviewResponseLength}
                    value={response?.kind === "text" ? response.value : ""}
                    onChange={(event) => respond({ kind: "text", value: event.target.value })} />
                </label>
              ) : null}
              <Button ref={reveal} disabled={busy} onClick={revealAnswer}>
                Show answer
              </Button>
            </>
          ) : (
            <div ref={answer} tabIndex={-1} className="space-y-3 outline-none">
              {attemptedAnswer ? (
                <div className="space-y-1 rounded-xl bg-muted/50 p-3">
                  <p className="text-sm font-medium">{t(response?.kind === "choice" ? "study.recall.yourChoice" : "study.recall.yourAnswer")}</p>
                  <StudyText text={attemptedAnswer} className="wrap-break-word" />
                </div>
              ) : null}
              <div className="space-y-1 border-t pt-4">
                {attemptedAnswer ? <p className="text-sm font-medium">{t("study.recall.savedAnswer")}</p> : null}
                <StudyText text={item.kind === "card" ? item.back : item.quote} className="wrap-break-word" />
              </div>
              {item.kind === "card" && item.backImage ? (
                <StudyCardImage
                  side="answer"
                  image={item.backImage}
                  onOpenChange={previewImage}
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
                  <p className="text-sm text-muted-foreground">
                    {t(cardCitations ? "study.capture.cardSources" : "study.capture.tutorAnswerSources")}
                  </p>
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
                onClick={openTutor}
              >
                {t(hasFeedback ? "study.recall.continueTutorFeedback" : feedbackId ? "study.recall.tutorFeedback" :
                  item.kind === "card" ? "study.recall.tutorCardAction" : "study.highlights.discussOne")}
              </Button>
              {practiced ? (
                <Button
                  onClick={() => {
                    setSession((value) => ({
                      ...value,
                      practiced: [...practiced, item.id],
                      revealed: "",
                      position: undefined,
                      response: undefined,
                      feedbackId: undefined,
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
          <p ref={status} role="status" tabIndex={-1} className="outline-none">
            {busy || awaitingHistory ? (
              t("study.recall.savingRating")
            ) : nextRetry ? (
              t("study.recall.learningWaiting", { count: waiting.length })
            ) : practiced ? (
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
          {nextRetry ? <RetryCountdown dueAt={nextRetry.schedule.dueAt} /> : null}
          <div className="flex flex-wrap items-center gap-3">
            {difficult.length ? (
              <Button onClick={() => practiceDifficult(difficult.map(({ item }) => item.id))}>
                {t(useHighlights ? "study.recall.practiceWeakHighlights" : "study.recall.practiceWeakCards", {
                  count: difficult.length,
                })}
              </Button>
            ) : null}
            {items.length && !nextRetry && !busy && !awaitingHistory ? (
              <Button
                variant="outline"
                onClick={() =>
                  setSession((value) => ({
                    ...value,
                    practiced: [],
                    revealed: "",
                    position: undefined,
                    response: undefined,
                    feedbackId: undefined,
                  }))
                }
              >
                {t("study.recall.practiceNow")}
              </Button>
            ) : null}
            {nextRetry ? (
              <Link
                to={studyHref("today", { vault: vaultId })}
                className="underline underline-offset-4"
              >
                {t("study.recall.backToToday")}
              </Link>
            ) : null}
            <Link
              to={library}
              className="underline underline-offset-4"
            >
              {libraryName}
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
  noteId,
  clearFilter,
  review,
  practice,
  openingPractice,
  creation,
}: {
  cards: Card[];
  vaultId: string;
  filter?: string;
  noteId?: string;
  clearFilter: () => void;
  review: (ids?: string[], practiceOnly?: boolean) => void;
  practice: (ids: string[]) => void;
  openingPractice: boolean;
  creation: Pick<Card, "notebookId" | "origin" | "tags" | "vaultId"> | false;
}) {
  const { t } = useTranslation("home");
  const now = useStudyClock(cards);
  const [generating, setGenerating] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<CardEditor | null>(null);
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
      const matched = [card.front, card.back, ...(card.quizChoices ?? []), ...card.tags]
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
  const reviewIds = reviewSet.length === cards.length ? undefined : reviewSet.map(({ id }) => id);

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
    if (!editing?.front.trim() || !editing.back.trim() || saving) return;
    const change = {
      front: editing.front.trim(),
      back: editing.back.trim(),
      tags: [...new Set(editing.tags.map((tag) => tag.trim()).filter(Boolean))],
      quizChoices: editing.quizChoices,
      image: editing.image,
      backImage: editing.backImage,
    };
    setSaving(true);
    try {
      if (editing.mode === "create") {
        if (!creation) return;
        await saveStudyCard({ ...creation, ...change }, editing.id);
      } else {
        const saved = await updateStudyReviewItem({
          kind: "card",
          id: editing.id,
          change,
          updatedAt: Date.now(),
        });
        if (!saved) {
          toast.error(t("study.recall.editUnavailable"));
          return;
        }
      }
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
                    .map((card) => {
                      const choices = card.quizChoices?.length ? `\n${quizChoicesText(card.quizChoices)}` : "";
                      return `Q: ${card.front}${choices}\nA: ${card.back}`;
                    })
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
            onClick={() => review(reviewIds)}
            disabled={!reviewSet.length}
          >
            {selectedCards.length
              ? t("study.recall.reviewSelected", { count: selectedCards.length })
              : "Review these cards"}
          </Button>
          {reviewSet.length ? (
            <>
              <Button variant="outline" onClick={() => review(reviewIds, true)}>
                {t("study.recall.practiceNow")}
              </Button>
              <Button
                variant="outline"
                disabled={openingPractice}
                onClick={() => practice(reviewSet.map(({ id }) => id))}
              >
                {t("study.recall.tutorAction")}
              </Button>
            </>
          ) : null}
          {!filter && !generating ? (
            <>
              <StudyFlashcardDrafts key={vaultId} vaultId={vaultId} />
              <Button variant="outline" onClick={() => setGenerating(true)}>
                Generate from text
              </Button>
            </>
          ) : null}
          {creation === false ? null : (
            <Button
              onClick={() =>
                setEditing({
                  id: studyId(),
                  mode: "create",
                  front: "",
                  back: "",
                  tags: creation.tags,
                })
              }
            >
              New flashcard
            </Button>
          )}
        </div>
      </div>
      {generating && !filter ? (
        <StudyFlashcardGenerator key={vaultId} close={() => setGenerating(false)} vaultId={vaultId} />
      ) : null}
      {filter ? (
        <FilterCaption label={filter} clear={clearFilter}>
          {noteId ? (
            <StudyOriginLink origin={{ kind: "note", noteId }} label={t("study.recall.backToNote")} />
          ) : null}
        </FilterCaption>
      ) : null}
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
          {editing.quizChoices?.length ? (
            <div className="space-y-2 rounded-lg border p-3">
              <StudyCardChoices choices={editing.quizChoices} />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setEditing({ ...editing, quizChoices: [] })}
              >
                {t("study.recall.removeAnswerChoices")}
              </Button>
            </div>
          ) : null}
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
              <StudyText text={card.front} className="font-medium wrap-break-word" />
              {card.quizChoices?.length ? (
                <details className="my-1 text-sm">
                  <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {t("study.recall.answerChoices")}
                  </summary>
                  <StudyCardChoices choices={card.quizChoices} showLabel={false} className="mt-2" />
                </details>
              ) : null}
              {card.image ? (
                <img
                  className="my-2 max-h-20 rounded object-contain"
                  src={card.image}
                  alt="Question attachment"
                />
              ) : null}
              {view === "list" || flipped === card.id ? (
                <>
                  <StudyText
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
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing({ ...card, mode: "edit" })}
              >
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

function FilterCaption({ label, clear, children }: { label: string; clear: () => void; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span dir="auto">{label}</span>
      <Button variant="ghost" size="sm" onClick={clear}>
        Show all
      </Button>
      {children}
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
  review: (ids?: string[], practiceOnly?: boolean) => void;
  discuss: (ids: string[]) => void;
  openingTutor: boolean;
}) {
  const { t } = useTranslation(["home", "common"]);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [color, setColor] = useState<StudyHighlightColor | "all">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Highlight | null>(null);
  const [deleting, setDeleting] = useState<Highlight | null>(null);
  const [saving, setSaving] = useState(false);
  const search = query.trim().toLowerCase();
  const visible = highlights.filter(
    (item) => (color === "all" || item.color === color) &&
      `${item.quote} ${item.note} ${item.cue ?? ""}`.toLowerCase().includes(search),
  );
  const selectedIds = new Set(selected);
  const checked = visible.filter(({ id }) => selectedIds.has(id));
  const targetIds = (checked.length ? checked : visible).map(({ id }) => id);
  const narrowed = Boolean(checked.length || search || color !== "all");
  const reviewLabel = checked.length
    ? t("study.highlights.reviewSelected", { count: checked.length })
    : narrowed
      ? t("study.highlights.reviewMatches", { count: visible.length })
      : t("study.highlights.review");

  async function saveHighlight(event: FormEvent) {
    event.preventDefault();
    if (!editing || saving) return;
    const { id, note, cue, color } = editing;
    setSaving(true);
    try {
      const saved = await updateStudyReviewItem({
        kind: "highlight",
        id,
        change: { note, cue, color },
        updatedAt: Date.now(),
      });
      if (!saved) toast.error(t("study.recall.editUnavailable"));
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
          {targetIds.length ? (
            <Button variant="outline" onClick={() => review(narrowed ? targetIds : undefined, true)}>
              {t("study.recall.practiceNow")}
            </Button>
          ) : null}
          <Button
            onClick={() => review(narrowed ? targetIds : undefined)}
            disabled={!targetIds.length}
          >
            {reviewLabel}
          </Button>
        </div>
      </div>
      {filter ? <FilterCaption label={filter} clear={clearFilter} /> : null}
      <div className="flex flex-wrap gap-2">
        <Input
          type="search"
          aria-label="Search highlights"
          placeholder="Search highlights"
          className="min-w-0 flex-1 basis-48"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label={t("study.highlights.colorFilter")}
          className="h-9 rounded-lg border bg-background px-2 text-sm"
          value={color}
          onChange={(event) => {
            const choice = studyHighlightColor.safeParse(event.target.value);
            setColor(choice.success ? choice.data : "all");
          }}
        >
          <option value="all">{t("study.highlights.allColors")}</option>
          {studyHighlightColor.options.map((name) => (
            <option key={name} value={name}>
              {t(`study.highlights.colors.${name}`)}
            </option>
          ))}
        </select>
      </div>
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
                <blockquote className="min-w-0 flex-1 font-medium wrap-break-word">
                  <StudyText text={item.quote} />
                </blockquote>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${highlightColors[item.color]}`}
                >
                  {t(`study.highlights.colors.${item.color}`)}
                </span>
              </div>
              {editing?.id === item.id ? (
                <form className="space-y-2" onSubmit={saveHighlight}>
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
                      Save highlight
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={saving}
                      onClick={() => setEditing(null)}
                    >
                      {t("common:actions.cancel")}
                    </Button>
                  </div>
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
