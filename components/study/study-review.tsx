import { ArrowLeft01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DirectionalText } from "@/components/common/directional-text";
import { Icon } from "@/components/icon";
import { Button, buttonVariants } from "@/components/panelui/button";
import { Textarea } from "@/components/panelui/textarea";
import { rateStudyItem, studyId } from "@/lib/db/study";
import {
  studyCitationOrigin,
  studyCollectionHref,
  studyHighlightOrigin,
  studyHref,
} from "@/lib/study/links";
import {
  difficultStudyItems,
  studyHighlightPreview,
  studyReviewFeedback,
  studyReviewMaterial,
} from "@/lib/study/recall";
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
  studyReviewKind,
  type ReviewResponse,
  type ReviewSnapshot,
  type ReviewTutorFeedback,
} from "@/lib/study/review-session";
import { studyReturnState } from "@/lib/study/return-links";
import { studyIntervalLabel } from "@/lib/study/schedule";
import { vocabularyOrigin } from "@/lib/study/vocabulary";
import {
  maxReviewAttemptAnswer,
  studyRatings,
  type StudyBook,
  type StudyRating,
  type StudyRecordOf,
  type StudyThread,
} from "@/lib/study/records";
import { cn } from "@/lib/utils";
import { StudyCardChoices } from "./study-card-choices";
import { StudyCardImage } from "./study-card-image";
import { studyDueLabel } from "./study-due";
import { highlightColors } from "./study-highlight-colors";
import { StudyListenButton } from "./study-listen";
import { StudyOriginLink } from "./study-origin-link";
import { StudyText } from "./study-text";
import { useStudyClock } from "./use-study-clock";
import { StudyAcrossVaultsSwitch, StudyVaultLabel } from "./study-vault-scope";

type Card = StudyRecordOf<"card">;
type Highlight = StudyRecordOf<"highlight">;
type Word = StudyRecordOf<"word">;

const ratingTones: Record<StudyRating, string> = {
  again: "text-destructive",
  hard: "text-warning",
  good: "text-success",
  easy: "text-info",
};
const kindDots = { card: "bg-chart-3", word: "bg-chart-2" };

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
  collectionSource,
  history,
  sessionId,
  continueReading,
  ordered = false,
}: {
  /** The items come in the order given (a plan, a notebook at a time), not by due time. */
  ordered?: boolean;
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
  collectionSource?: { href: string; label: string };
  history: StudyRecordOf<"session">[];
  sessionId: string;
  continueReading?: StudyBook;
}) {
  const { t, i18n } = useTranslation("home");
  const now = useStudyClock(items);
  const location = useLocation();
  const links = studyReturnState(location.state);
  const path = location.pathname + location.search;
  const destination = useMemo(() => {
    const selection = reviewSelection(location.state);
    return {
      path,
      state: {
        ...selection,
        ...studyReturnState(location.state),
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
  const grades = history.filter(
    (review) => review.activity === "review" && review.reviewSessionId === sessionId,
  );
  const rated = Math.max(session.rated, grades.length);
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
  const queue = reviewQueue(items, practiced, now, ordered).filter(
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
  const difficult = !item && rated && !practiced && !busy && !awaitingHistory
    ? difficultStudyItems(items, history, sessionId)
    : [];
  const followThrough = difficult
    .toSorted((a, b) => b.reviewedAt - a.reviewedAt)
    .find(({ attempt }) => attempt !== undefined);
  const followThroughAttempt = followThrough?.attempt;
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
  const attempt = item && attemptedAnswer && feedbackId
    ? {
        ...studyReviewMaterial(item),
        answer: attemptedAnswer.slice(0, maxReviewAttemptAnswer),
        choice: response?.kind === "choice" ? response.index : undefined,
        threadId: feedbackId,
      }
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
        attempt,
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

  // Space shows the answer and 1–4 grade it, unless the learner is typing in a field.
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
  const kind = item ? studyReviewKind(item) : undefined;
  const library =
    libraryHref ?? studyCollectionHref(useHighlights ? "highlights" : "all", { vault: vaultId });
  const libraryName = libraryLabel ?? t("study.review.openCollection");
  const returnState = { studyReturn: destination };
  const total = rated + queue.length;
  const sourceBookId = word?.bookId ?? (origin?.kind === "book" ? origin.bookId : undefined);
  const sourceBook = highlightBook ?? books.find(({ id }) => id === sourceBookId);
  const source =
    item?.kind === "highlight"
      ? [sourceBook?.title, sourceBook?.sections[item.section]?.title].filter(Boolean).join(" · ")
      : (sourceBook?.title ?? (word ? word.language : item?.tags[0]));
  const counts = Object.fromEntries(
    studyRatings.map((rating) => [rating, grades.filter((review) => review.rating === rating).length]),
  ) as Record<StudyRating, number>;
  const difficultKinds = new Set(difficult.map(({ item }) => item.kind));
  const practiceDifficultLabel = difficultKinds.size > 1
    ? t("study.review.practiceDifficult", { count: difficult.length })
    : t(difficultKinds.has("highlight") ? "study.recall.practiceWeakHighlights" : "study.recall.practiceWeakCards", {
        count: difficult.length,
      });

  function openTutor() {
    if (!item) return;
    practice(item, returnState, attempt ? studyReviewFeedback(t, item, attempt) : undefined);
  }

  const done = !item && !busy && !awaitingHistory && !nextRetry && !practiced;

  return (
    <section className="mx-auto max-w-2xl space-y-4" aria-labelledby="study-review-title" onKeyDown={keydown}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to={studyHref("today", { vault: vaultId })}
          className={buttonVariants({ variant: "ghost", size: "sm", className: "-ms-2" })}
        >
          <Icon icon={ArrowLeft01Icon} className="rtl:rotate-180" />
          {t("study.tabs.today")}
        </Link>
        <p className="text-sm text-muted-foreground tabular-nums">
          {practiced
            ? t("study.recall.practiceRemaining", { count: queue.length })
            : item
              ? t("study.review.position", { current: Math.min(rated + 1, total), total })
              : t("study.review.reviewed", { count: rated })}
        </p>
      </div>
      <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${total ? (practiced ? 0 : rated / total) * 100 : 100}%` }}
        />
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id="study-review-title" className="me-auto text-sm font-medium" dir="auto">
          {collection ?? t("study.review.title")}
        </h2>
        {item && libraryHref ? (
          <Link to={library} state={links} className="text-sm text-muted-foreground underline underline-offset-4">
            {libraryName}
          </Link>
        ) : null}
        {collectionSource ? (
          <Link
            to={collectionSource.href}
            state={returnState}
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            {collectionSource.label}
          </Link>
        ) : null}
        <StudyAcrossVaultsSwitch compact className="text-sm text-muted-foreground" />
      </div>
      {item && kind ? (
        <div className="flex min-h-[24rem] flex-col gap-5 rounded-3xl border bg-card p-5 shadow-xs sm:p-7">
          <div className="flex min-w-0 items-center justify-between gap-3 text-xs">
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-medium">
              <span
                aria-hidden="true"
                className={cn("size-2 rounded-full", item.kind === "highlight" ? highlightColors[item.color] : kindDots[kind === "word" ? "word" : "card"])}
              />
              {t(`study.collection.kinds.${kind}`)}
            </span>
            <StudyVaultLabel row={item} className="me-auto" />
            {source ? (
              <span className="min-w-0 truncate text-muted-foreground" dir="auto">
                {source}
              </span>
            ) : null}
          </div>
          {word ? (
            <div className="flex items-start gap-2">
              <StudyText
                text={question}
                className="min-w-0 font-serif text-4xl leading-tight font-medium wrap-break-word"
              />
              <StudyListenButton text={word.term} className="mt-1 shrink-0" />
            </div>
          ) : (
            <StudyText
              text={question}
              className="text-xl leading-snug font-semibold tracking-tight wrap-break-word sm:text-2xl"
            />
          )}
          {word && word.context && word.context !== question ? (
            <DirectionalText
              multiline
              text={word.context}
              className="line-clamp-3 font-serif text-base text-muted-foreground italic"
            />
          ) : null}
          <StudyCardChoices choices={choices} selection={isRevealed ? undefined : {
            index: response?.kind === "choice" ? response.index : undefined,
            choose: (index) => respond({ kind: "choice", index }),
          }} />
          {item.kind === "card" && item.image ? (
            <StudyCardImage side="question" image={item.image} onOpenChange={previewImage} />
          ) : null}
          {!isRevealed ? (
            <div className="mt-auto space-y-4">
              {!choices ? (
                <label className="grid gap-1.5 text-sm text-muted-foreground">
                  {t("study.recall.writeAnswer")}
                  <Textarea
                    dir="auto"
                    minRows={2}
                    maxRows={5}
                    maxLength={maxReviewResponseLength}
                    value={response?.kind === "text" ? response.value : ""}
                    onChange={(event) => respond({ kind: "text", value: event.target.value })}
                  />
                </label>
              ) : null}
              <Button ref={reveal} size="lg" className="w-full" disabled={busy} onClick={revealAnswer}>
                {t("study.review.showAnswer")}
              </Button>
              <p className="text-center text-xs text-muted-foreground">{t("study.review.keys")}</p>
            </div>
          ) : (
            <div ref={answer} tabIndex={-1} className="flex flex-1 flex-col gap-4 outline-none">
              <div className="space-y-3 border-t border-dashed pt-4">
                {attemptedAnswer ? (
                  <div className="space-y-1 rounded-xl bg-muted/60 p-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t(response?.kind === "choice" ? "study.recall.yourChoice" : "study.recall.yourAnswer")}
                    </p>
                    <StudyText text={attemptedAnswer} className="wrap-break-word" />
                  </div>
                ) : null}
                {attemptedAnswer ? (
                  <p className="text-xs font-medium text-muted-foreground">{t("study.recall.savedAnswer")}</p>
                ) : null}
                <StudyText
                  text={item.kind === "card" ? item.back : item.quote}
                  className={cn(
                    "wrap-break-word",
                    item.kind === "highlight" ? "font-serif text-lg leading-relaxed" : "text-base leading-relaxed",
                  )}
                />
                {item.kind === "card" && item.backImage ? (
                  <StudyCardImage side="answer" image={item.backImage} onOpenChange={previewImage} />
                ) : null}
                {item.kind === "highlight" && item.note ? (
                  <DirectionalText
                    multiline
                    text={item.note}
                    className="rounded-xl bg-muted/60 px-3 py-2 text-sm text-muted-foreground"
                  />
                ) : null}
                {citations.length && !busy ? (
                  <div>
                    <p className="text-xs text-muted-foreground">
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
                <div className="flex flex-wrap items-center gap-1">
                  <Button variant="ghost" size="sm" disabled={busy || openingPractice} onClick={openTutor}>
                    {t(hasFeedback ? "study.recall.continueTutorFeedback" : feedbackId ? "study.recall.tutorFeedback" :
                      "study.review.askAi")}
                  </Button>
                  {origin && origin.kind !== "word" && !busy ? (
                    <StudyOriginLink origin={origin} state={returnState} />
                  ) : null}
                  {wordOrigin && !busy ? <StudyOriginLink origin={wordOrigin} state={returnState} /> : null}
                </div>
              </div>
              {practiced ? (
                <Button
                  size="lg"
                  className="mt-auto w-full"
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
                <div className="mt-auto grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {studyRatings.map((rating, index) => (
                    <Button
                      key={rating}
                      variant="outline"
                      className={cn("h-16 flex-col gap-0.5 rounded-xl text-sm", ratingTones[rating])}
                      disabled={busy}
                      onClick={() => void grade(rating, Date.now())}
                      aria-keyshortcuts={String(index + 1)}
                    >
                      {t(`study.review.ratings.${rating}`)}
                      <span className="text-xs font-normal text-muted-foreground">
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
        <div
          className={cn(
            "flex flex-col gap-4 rounded-3xl border bg-card p-6 text-sm text-muted-foreground sm:p-8",
            done && "items-center text-center",
          )}
        >
          {done ? (
            <span className="grid size-14 place-items-center rounded-full bg-primary text-primary-foreground">
              <Icon icon={Tick02Icon} size={26} />
            </span>
          ) : null}
          {done ? (
            <h3 className="text-2xl font-semibold tracking-tight text-foreground">
              {t(rated > 0 ? "study.review.doneTitle" : "study.review.nothingDue")}
            </h3>
          ) : null}
          <p ref={status} role="status" tabIndex={-1} className="outline-none">
            {busy || awaitingHistory ? (
              t("study.recall.savingRating")
            ) : nextRetry ? (
              t("study.recall.learningWaiting", { count: waiting.length })
            ) : practiced ? (
              t("study.recall.practiceComplete", { count: practiced.length })
            ) : (
              <>
                {rated > 0 ? `${t("study.review.reviewed", { count: rated })} · ` : ""}
                {remaining
                  ? studyDueLabel(t, i18n.language, remaining.schedule.dueAt, now)
                  : t("study.review.empty")}
              </>
            )}
          </p>
          {nextRetry ? <RetryCountdown dueAt={nextRetry.schedule.dueAt} /> : null}
          {done && rated > 0 ? (
            <dl className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
              {studyRatings.map((rating) => (
                <div key={rating} className="rounded-2xl border bg-background p-3 text-start">
                  <dt className={cn("text-xs font-medium", ratingTones[rating])}>
                    {t(`study.review.ratings.${rating}`)}
                  </dt>
                  <dd className="text-2xl font-semibold text-foreground tabular-nums">{counts[rating]}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {followThrough && followThroughAttempt ? (
            <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-start">
              <DirectionalText
                as="span"
                text={studyHighlightPreview(followThroughAttempt.cue || t("study.recall.highlightPrompt"))}
                className="min-w-0 flex-1 wrap-break-word"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={openingPractice}
                onClick={() => practice(
                  followThrough.item,
                  returnState,
                  studyReviewFeedback(t, followThrough.item, followThroughAttempt),
                )}
              >
                {t(threads.some(({ id }) => id === followThroughAttempt.threadId)
                  ? "study.recall.continueTutorFeedback" : "study.recall.tutorFeedback")}
              </Button>
            </div>
          ) : null}
          <div className={cn("flex flex-wrap items-center gap-2", done && "justify-center")}>
            {done && continueReading ? (
              <Link
                to={studyHref("library", { book: continueReading.id, vault: vaultId })}
                className={buttonVariants({ shape: "pill" })}
              >
                <span className="max-w-64 truncate" dir="auto">
                  {t("study.review.keepReading", { title: continueReading.title })}
                </span>
              </Link>
            ) : null}
            {difficult.length && !nextRetry ? (
              <Button
                shape="pill"
                variant={continueReading ? "outline" : "default"}
                onClick={() => practiceDifficult(difficult.map(({ item }) => item.id))}
              >
                {practiceDifficultLabel}
              </Button>
            ) : null}
            {items.length && !nextRetry && !busy && !awaitingHistory ? (
              <Button
                shape="pill"
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
            <Link to={studyHref("today", { vault: vaultId })} className={buttonVariants({ variant: "ghost", shape: "pill" })}>
              {t("study.recall.backToToday")}
            </Link>
            <Link to={library} state={links} className={buttonVariants({ variant: "ghost", shape: "pill" })}>
              {libraryName}
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
