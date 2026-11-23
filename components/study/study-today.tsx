import {
  Cards01Icon,
  FireIcon,
  HighlighterIcon,
  Tick02Icon,
  TranslateIcon,
} from "@hugeicons/core-free-icons";
import { useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DirectionalText } from "@/components/common/directional-text";
import { Icon, type IconSvgElement } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Card } from "@/components/panelui/card";
import { studyVocabularyCards } from "@/lib/db/study";
import { studyActivityGroups } from "@/lib/study/activity";
import { studyCollectionHref, studyHighlightOrigin, studyHref } from "@/lib/study/links";
import { difficultStudyItems, studyHighlightPreview, studyReviewFeedback } from "@/lib/study/recall";
import { studyReadingProgress } from "@/lib/study/reading-progress";
import { studyReportKey } from "@/lib/study/reports";
import {
  dailyReview,
  pendingReviewLearning,
  reviewCollection,
  reviewQueue,
  savedReview,
  type ReviewTutorFeedback,
} from "@/lib/study/review-session";
import { studyRatings, type StudyBook, type StudyRecord, type StudyThread } from "@/lib/study/records";
import type { StudyTab } from "@/lib/study/links";
import { vocabularyCardSides } from "@/lib/study/vocabulary";
import { textDirection } from "@/lib/text/direction";
import { cn } from "@/lib/utils";
import { StudyActivity } from "./study-activity";
import { StudyBookCover, StudyProgressBar } from "./study-book-cover";
import { studyDueLabel } from "./study-due";
import { StudyFollowUps } from "./study-follow-ups";
import { StudyListenButton } from "./study-listen";
import { StudyMakeFromBook } from "./study-make-from-book";
import { StudyOriginLink } from "./study-origin-link";
import { useStudyClock } from "./use-study-clock";

type Go = (tab: StudyTab, params?: Record<string, string>, review?: string[]) => void;

function Panel({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <Card as="section" aria-label={label} className={cn("min-w-0 shadow-none", className)}>
      <Card.Content className="flex h-full min-w-0 flex-col gap-4">{children}</Card.Content>
    </Card>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium text-muted-foreground">{children}</p>;
}

/** The byline under a cover: the notebook a book belongs to, when it is not just the book's own name. */
export function studyBookByline(book: StudyBook, notebookTitles: ReadonlyMap<string, string>) {
  const notebook = notebookTitles.get(book.notebookId);
  return notebook && notebook.trim() !== book.title.trim() ? notebook : undefined;
}

export function DailyStudy({
  rows,
  books,
  notebookTitles,
  vaultId,
  go,
  read,
  askChapter,
  teachBack,
  practice,
  openingPractice,
}: {
  rows: StudyRecord[];
  books: StudyBook[];
  notebookTitles: ReadonlyMap<string, string>;
  vaultId: string;
  go: Go;
  read: (book: StudyBook) => void;
  askChapter: (book: StudyBook) => void;
  teachBack: (book: StudyBook) => void;
  practice: (kind: "card" | "highlight", ids: string[], feedback?: ReviewTutorFeedback) => void;
  openingPractice: boolean;
}) {
  const { t, i18n } = useTranslation("home");
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState({ card: false, highlight: false });
  const [openingWords, setOpeningWords] = useState(false);
  const wordRequest = useRef(false);
  const reviewable = rows.filter((row) => row.kind === "card" || row.kind === "highlight");
  const now = useStudyClock(reviewable);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const sessions = rows.filter((item) => item.kind === "session");
  const threads = rows.filter((item) => item.kind === "thread");
  const cards = rows.filter((item) => item.kind === "card");
  const highlights = rows.filter((item) => item.kind === "highlight");
  const words = rows.filter((item) => item.kind === "word");
  const threadIds = new Set(threads.map(({ id }) => id));
  const recentReport = threads
    .flatMap((thread) => (thread.report ? [{ thread, report: thread.report }] : []))
    .sort(
      (a, b) =>
        (b.report.generatedAt ?? b.thread.updatedAt) - (a.report.generatedAt ?? a.thread.updatedAt),
    )[0];
  const activity = sessions.filter((item) => item.updatedAt >= today.getTime());
  const daily = dailyReview(rows, now);
  const difficult = difficultStudyItems(reviewable, sessions);
  const paused = savedReview(vaultId);
  const pausedItems = paused
    ? reviewCollection(
        rows,
        new URLSearchParams(paused.path.split("?", 2)[1]),
        paused.state.studyReviewIds,
      )
    : [];
  const resume =
    paused &&
    (reviewQueue(pausedItems, paused.snapshot.practiced, now).length > 0 ||
      (!paused.snapshot.practiced &&
        pendingReviewLearning(pausedItems, sessions, paused.state.studyReviewSession, now).length > 0))
      ? paused
      : undefined;
  const lastRead =
    books
      .filter((entry) => entry.lastReadAt !== undefined)
      .toSorted((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0] ?? books[0];
  const dates = new Set(sessions.map((item) => new Date(item.updatedAt).toDateString()));
  let streak = 0;
  const cursor = new Date(today);
  if (!dates.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
  while (dates.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  const percent = new Intl.NumberFormat(i18n.language, { style: "percent" });
  const practisable = words.filter((word) => vocabularyCardSides(word)).map(({ id }) => id);

  async function practiseWords() {
    if (wordRequest.current || !practisable.length) return;
    wordRequest.current = true;
    setOpeningWords(true);
    try {
      const ids = await studyVocabularyCards(practisable, vaultId);
      if (ids.length) go("review", { kind: "vocabulary" }, ids);
      else toast.info(t("study.vocabulary.noCards"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      wordRequest.current = false;
      setOpeningWords(false);
    }
  }

  function startReview() {
    if (resume) void navigate(resume.path, { state: resume.state });
    else go("review");
  }

  const breakdown: { key: keyof typeof daily.counts; icon: IconSvgElement; label: string }[] = [
    { key: "highlight", icon: HighlighterIcon, label: t("study.collection.filters.highlights") },
    { key: "word", icon: TranslateIcon, label: t("study.collection.filters.words") },
    { key: "card", icon: Cards01Icon, label: t("study.collection.filters.cards") },
  ];

  return (
    <section className="mx-auto max-w-5xl space-y-6" aria-labelledby="study-today-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>
            {new Intl.DateTimeFormat(i18n.language, { weekday: "long", month: "long", day: "numeric" }).format(today)}
          </Eyebrow>
          <h2 id="study-today-title" className="text-2xl font-semibold tracking-tight">
            {t("study.tabs.today")}
          </h2>
        </div>
        {streak ? (
          <p className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-sm font-medium">
            <Icon icon={FireIcon} size={16} className="text-warning" />
            {t("study.today.streak", { count: streak })}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        {lastRead ? (
          <ContinueReading
            book={lastRead}
            byline={studyBookByline(lastRead, notebookTitles)}
            counts={{
              highlights: highlights.filter(({ bookId }) => bookId === lastRead.id).length,
              words: words.filter(
                (word) =>
                  word.bookId === lastRead.id ||
                  (word.origin?.kind === "book" && word.origin.bookId === lastRead.id),
              ).length,
              cards: cards.filter(
                (card) =>
                  card.origin?.kind !== "word" &&
                  (card.origin?.kind === "book" ? card.origin.bookId === lastRead.id : card.notebookId === lastRead.notebookId),
              ).length,
            }}
            progress={percent}
            read={() => read(lastRead)}
            ask={() => askChapter(lastRead)}
            teachBack={() => teachBack(lastRead)}
          />
        ) : (
          <Panel label={t("study.today.continueReading")}>
            <Eyebrow>{t("study.today.continueReading")}</Eyebrow>
            <h3 className="font-serif text-2xl font-medium">{t("study.today.noBookTitle")}</h3>
            <p className="text-sm text-muted-foreground">{t("study.today.noBookDescription")}</p>
            <Button className="mt-auto self-start" shape="pill" onClick={() => go("library")}>
              {t("study.today.addBook")}
            </Button>
          </Panel>
        )}

        <Panel label={t("study.today.dailyReview")}>
          <Eyebrow>{t("study.today.dailyReview")}</Eyebrow>
          {daily.due.length || resume ? (
            <>
              <div className="flex items-center gap-3">
                <span className="text-5xl leading-none font-semibold tracking-tighter tabular-nums">
                  {daily.due.length}
                </span>
                <span className="text-sm text-muted-foreground">{t("study.today.dueNow", { count: daily.due.length })}</span>
              </div>
              <ul className="divide-y text-sm">
                {breakdown.map(({ key, icon, label }) => (
                  <li key={key} className="flex items-center gap-3 py-2">
                    <span className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground">
                      <Icon icon={icon} size={16} />
                    </span>
                    <span className="me-auto">{label}</span>
                    <span className="font-semibold tabular-nums">{daily.counts[key]}</span>
                  </li>
                ))}
              </ul>
              <Button size="lg" className="mt-auto w-full" onClick={startReview}>
                {t(resume ? "study.today.resumeReview" : "study.today.startReview")}
              </Button>
            </>
          ) : (
            <>
              <span className="grid size-12 place-items-center rounded-full bg-primary text-primary-foreground">
                <Icon icon={Tick02Icon} size={22} />
              </span>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">{t("study.today.doneTitle")}</h3>
                <p className="text-sm text-muted-foreground">
                  {daily.next
                    ? studyDueLabel(t, i18n.language, daily.next, now)
                    : t("study.today.nothingSaved")}
                </p>
              </div>
              {lastRead ? (
                <Button variant="outline" className="mt-auto w-full" onClick={() => read(lastRead)}>
                  {t("study.today.keepReading")}
                </Button>
              ) : null}
            </>
          )}
        </Panel>
      </div>

      {words.length || threads.length || lastRead ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {words.length ? (
            <Panel label={t("study.today.yourWords")}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{t("study.today.yourWords")}</h3>
                <Link
                  to={studyCollectionHref("words", { vault: vaultId })}
                  className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  {t("study.today.seeAllWords", { count: words.length })}
                </Link>
              </div>
              <ul className="divide-y">
                {words.slice(0, 4).map((word) => (
                  <li key={word.id} className="flex min-w-0 items-center gap-3 py-2">
                    <span className="min-w-0 flex-1 truncate font-medium" dir={textDirection(word.term)}>
                      {word.term}
                    </span>
                    {word.translation ? (
                      <span
                        className="max-w-[50%] truncate text-sm text-muted-foreground"
                        dir={textDirection(word.translation)}
                      >
                        {word.translation}
                      </span>
                    ) : null}
                    <StudyListenButton text={word.term} />
                  </li>
                ))}
              </ul>
              {practisable.length ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-auto self-start"
                  loading={openingWords}
                  onClick={() => void practiseWords()}
                >
                  {t("study.today.practiseWords")}
                </Button>
              ) : null}
            </Panel>
          ) : null}
          {threads.length ? (
            <TutorPanel
              threads={threads}
              books={books}
              rows={rows}
              vaultId={vaultId}
              go={go}
              report={
                recentReport ? (
                  <StudyOriginLink
                    label={t("study.followUps.lastReport")}
                    origin={{
                      kind: "report",
                      threadId: recentReport.thread.id,
                      reportId: studyReportKey(recentReport.report),
                    }}
                  />
                ) : null
              }
            />
          ) : null}
          {lastRead ? (
            <Panel label={t("study.make.title", { title: lastRead.title })}>
              <StudyMakeFromBook book={lastRead} compact />
            </Panel>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-6 border-t pt-6">
        <StudyFollowUps threads={threads} today={today.getTime()} vaultId={vaultId} />
        {activity.length ? (
          <dl className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-3">
            {(["reading", "review", "speaking"] as const).map((key) => {
              const seconds = activity
                .filter((item) => item.activity === key)
                .reduce((n, item) => n + item.seconds, 0);
              return (
                <div key={key} className="bg-card p-3">
                  <dt className="text-xs text-muted-foreground">{t(`study.today.activity.${key}`)}</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {seconds > 0 && seconds < 60
                      ? t("study.today.underMinute")
                      : t("study.today.minutes", { count: Math.floor(seconds / 60) })}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : null}
        {difficult.length ? (
          <section className="space-y-3" aria-label={t("study.recall.needsPractice")}>
            <h3 className="font-semibold">{t("study.recall.needsPractice")}</h3>
            {(["card", "highlight"] as const).map((kind) => {
              const entries = difficult.filter(({ item }) => item.kind === kind);
              if (!entries.length) return null;
              const isHighlight = kind === "highlight";
              return (
                <div key={kind} className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        go("review", isHighlight ? { mode: "weak", kind: "highlights" } : { mode: "weak", kind: "cards" })
                      }
                    >
                      {t(isHighlight ? "study.recall.practiceWeakHighlights" : "study.recall.practiceWeakCards", {
                        count: entries.length,
                      })}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={openingPractice}
                      onClick={() => practice(kind, entries.map(({ item }) => item.id))}
                    >
                      {isHighlight
                        ? t("study.highlights.discuss", { count: entries.length })
                        : t("study.recall.tutorAction")}
                    </Button>
                  </div>
                  <ul className="divide-y rounded-2xl border px-3">
                    {(expanded[kind] ? entries : entries.slice(0, 3)).map(({ item, rating, attempt }) => {
                      const origin = item.kind === "highlight" ? studyHighlightOrigin(item) : item.origin;
                      const prompt = item.kind === "highlight" ? item.cue || studyHighlightPreview(item.quote) : item.front;
                      const feedbackLabel =
                        attempt &&
                        t(threadIds.has(attempt.threadId) ? "study.recall.continueTutorFeedback" : "study.recall.tutorFeedback");
                      return (
                        <li key={item.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                          <span dir="auto" className="min-w-0 flex-1 wrap-break-word">
                            {prompt}
                          </span>
                          <span className="text-muted-foreground">{t(`study.recall.rating.${rating}`)}</span>
                          {origin ? <StudyOriginLink origin={origin} /> : null}
                          {attempt && feedbackLabel ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={openingPractice}
                              aria-label={t("study.recall.feedbackFor", { action: feedbackLabel, prompt })}
                              onClick={() => practice(kind, [item.id], studyReviewFeedback(t, item, attempt))}
                            >
                              {feedbackLabel}
                            </Button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                  {entries.length > 3 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={expanded[kind]}
                      onClick={() => setExpanded((value) => ({ ...value, [kind]: !value[kind] }))}
                    >
                      {t(expanded[kind] ? "study.recall.showFewerDifficult" : "study.recall.showMoreDifficult", {
                        count: entries.length - 3,
                      })}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </section>
        ) : null}
        {rows.length ? <StudyProgress rows={rows} books={books} now={now} vaultId={vaultId} /> : null}
        <StudyActivity rows={rows} sessions={sessions} />
      </div>
    </section>
  );
}

function ContinueReading({
  book,
  byline,
  counts,
  progress,
  read,
  ask,
  teachBack,
}: {
  book: StudyBook;
  byline?: string;
  counts: { highlights: number; words: number; cards: number };
  progress: Intl.NumberFormat;
  read: () => void;
  ask: () => void;
  teachBack: () => void;
}) {
  const { t } = useTranslation("home");
  const position = studyReadingProgress(book);
  const shown = position < 1 ? Math.min(0.99, position) : 1;
  const chapter = book.sections[book.section];
  return (
    <Panel label={t("study.today.continueReading")}>
      <div className="flex min-w-0 flex-1 gap-5">
        <button
          type="button"
          aria-label={t("study.today.openBook", { title: book.title })}
          className="w-24 shrink-0 cursor-pointer self-start rounded-e-xl outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:ring-ring/40 motion-reduce:transition-none sm:w-32"
          onClick={read}
        >
          <StudyBookCover book={book} byline={byline} className="w-full" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Eyebrow>{t("study.today.continueReading")}</Eyebrow>
          <h3 className="font-serif text-2xl leading-tight font-medium wrap-break-word sm:text-3xl" dir="auto">
            {book.title}
          </h3>
          {chapter && book.sections.length > 1 ? (
            <p className="text-sm text-muted-foreground" dir="auto">
              {chapter.title}
            </p>
          ) : null}
          <StudyProgressBar
            className="mt-1"
            value={shown}
            label={t("study.today.readingProgressFor", { title: book.title })}
          />
          <p className="text-xs text-muted-foreground">
            {t("study.today.bookProgress", { percent: progress.format(shown) })}
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button shape="pill" onClick={read}>
              {t("study.today.resumeReading")}
            </Button>
            {chapter?.text.trim() ? (
              <>
                <Button shape="pill" variant="outline" onClick={ask}>
                  {t("study.today.askChapter")}
                </Button>
                <Button shape="pill" variant="ghost" onClick={teachBack}>
                  {t("study.today.teachBack")}
                </Button>
              </>
            ) : null}
          </div>
          <p className="mt-auto pt-2 text-xs text-muted-foreground">
            {t("study.today.fromBook", {
              highlights: t("study.today.counts.highlights", { count: counts.highlights }),
              words: t("study.today.counts.words", { count: counts.words }),
              cards: t("study.today.counts.cards", { count: counts.cards }),
            })}
          </p>
        </div>
      </div>
    </Panel>
  );
}

function TutorPanel({
  threads,
  books,
  rows,
  vaultId,
  go,
  report,
}: {
  threads: StudyThread[];
  books: StudyBook[];
  rows: StudyRecord[];
  vaultId: string;
  go: Go;
  report: ReactNode;
}) {
  const { t } = useTranslation("home");
  const recent = threads.filter(({ messages }) => messages.length > 0).slice(0, 3);
  const fromThread = (threadId: string, origin?: { kind: string; threadId?: string }) =>
    (origin?.kind === "tutor" || origin?.kind === "report") && origin.threadId === threadId;
  return (
    <Panel label={t("study.today.fromTutor")}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{t("study.today.fromTutor")}</h3>
        <Button variant="link" size="sm" className="h-auto px-0 text-muted-foreground" onClick={() => go("tutor")}>
          {t("study.today.openTutor")}
        </Button>
      </div>
      {recent.length ? (
        <ul className="-mx-2 space-y-1">
          {recent.map((thread) => {
            const book = thread.bookId ? books.find(({ id }) => id === thread.bookId) : undefined;
            const chapter = book && thread.section !== undefined ? book.sections[thread.section]?.title : undefined;
            const made = rows.filter((row) => row.kind === "card" && fromThread(thread.id, row.origin)).length;
            const words = rows.filter((row) => row.kind === "word" && fromThread(thread.id, row.origin)).length;
            const reports = (thread.report ? 1 : 0) + (thread.pastReports?.length ?? 0);
            const chips = [
              made ? t("study.today.counts.cards", { count: made }) : undefined,
              words ? t("study.today.counts.words", { count: words }) : undefined,
              reports ? t("study.today.counts.reports", { count: reports }) : undefined,
            ].filter((chip): chip is string => Boolean(chip));
            return (
              <li key={thread.id}>
                <Link
                  to={studyHref("tutor", { thread: thread.id, vault: vaultId })}
                  className="flex min-w-0 flex-col gap-1 rounded-xl px-2 py-2 outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  <DirectionalText as="span" text={thread.title} className="truncate text-sm font-medium" />
                  {book ? (
                    <span className="truncate text-xs text-muted-foreground" dir="auto">
                      {[book.title, chapter].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                  {chips.length ? (
                    <span className="flex flex-wrap gap-1">
                      {chips.map((chip) => (
                        <span key={chip} className="rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
                          {chip}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("study.today.noTutor")}</p>
      )}
      {report ? <div className="mt-auto">{report}</div> : null}
    </Panel>
  );
}

function StudyProgress({
  rows,
  books,
  now,
  vaultId,
}: {
  rows: StudyRecord[];
  books: StudyBook[];
  now: number;
  vaultId: string;
}) {
  const { t, i18n } = useTranslation("home");
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 29);
  const cards = rows.filter((item) => item.kind === "card");
  const currentCards = new Set(cards.map((item) => item.id));
  const sessions = rows
    .filter((item) => item.kind === "session")
    .filter((item) => item.updatedAt >= cutoff.getTime());
  const reviews = sessions.filter((item) => item.activity === "review");
  const speaking = sessions.filter((item) => item.activity === "speaking");
  const recentRecall = reviews
    .filter((item) => item.rating && item.itemId && currentCards.has(item.itemId))
    .slice(0, 20);
  const totals = [
    { key: "cards", value: cards.length, href: studyCollectionHref("cards", { vault: vaultId }) },
    { key: "documents", value: books.length, href: studyHref("library", { vault: vaultId }) },
    {
      key: "highlights",
      value: rows.filter((item) => item.kind === "highlight").length,
      href: studyCollectionHref("highlights", { vault: vaultId }),
    },
    {
      key: "reviews",
      value: reviews.reduce((total, item) => total + item.count, 0),
      href: studyHref("review", { vault: vaultId }),
    },
    { key: "speakingSessions", value: studyActivityGroups(speaking).length, href: studyHref("tutor", { vault: vaultId }) },
    {
      key: "speakingMinutes",
      value: Math.round(speaking.reduce((total, item) => total + item.seconds, 0) / 60),
      href: studyHref("tutor", { vault: vaultId }),
    },
  ] as const;
  const reading = books
    .filter((book) => book.lastReadAt !== undefined || book.readingPlace || book.section > 0)
    .toSorted((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0));
  const percent = new Intl.NumberFormat(i18n.language, { style: "percent" });
  return (
    <section className="space-y-3" aria-label={t("study.today.progressTitle")}>
      <h3 className="font-semibold">{t("study.today.progressTitle")}</h3>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-3">
        {totals.map(({ key, value, href }, index) => (
          <div key={key} className="space-y-1 bg-card p-3">
            <dt className="text-xs text-muted-foreground">
              <Link to={href} className="hover:underline">
                {t(`study.today.totals.${key}`)}
              </Link>
            </dt>
            <dd className="text-lg font-semibold tabular-nums">{value}</dd>
            {index >= 3 ? <p className="text-xs text-muted-foreground">{t("study.today.lastThirtyDays")}</p> : null}
          </div>
        ))}
      </dl>
      {recentRecall.length ? (
        <div className="space-y-2 rounded-2xl border p-3 text-sm">
          <h4 className="font-medium">{t("study.today.recentRecall", { count: recentRecall.length })}</h4>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            {studyRatings.map((rating) => (
              <li key={rating}>
                {recentRecall.filter((item) => item.rating === rating).length} {t(`study.review.ratings.${rating}`)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {reading.length ? (
        <div className="space-y-2 rounded-2xl border p-3">
          <h4 className="text-sm font-medium">{t("study.today.readingProgress")}</h4>
          <ul className="space-y-3">
            {reading.map((book) => {
              const position = studyReadingProgress(book);
              const display = position < 1 ? Math.min(0.99, position) : 1;
              const progress = percent.format(display);
              return (
                <li key={book.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <Link
                      dir="auto"
                      to={studyHref("library", { book: book.id, vault: vaultId })}
                      className="min-w-0 wrap-break-word hover:underline"
                    >
                      {book.title}
                    </Link>
                    <span aria-hidden="true" className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {progress}
                    </span>
                  </div>
                  <StudyProgressBar
                    className="h-1"
                    value={display}
                    label={t("study.today.readingProgressFor", { title: book.title })}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
