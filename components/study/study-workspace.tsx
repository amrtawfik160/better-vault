import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { StudyOriginLink } from "./study-origin-link";
import { StudyFollowUps } from "./study-follow-ups";
import { originHref, queryIndex, studyHref } from "@/lib/study/links";
import { tutorBookOrigin } from "@/lib/study/passages";
import { studyHighlightPreview, weakStudyCards } from "@/lib/study/recall";
import { studyReportKey } from "@/lib/study/reports";
import {
  directReviewSession,
  reviewCollection,
  reviewQueue,
  reviewReturnState,
  reviewSelection,
  savedReview,
  studyCardsInScope,
} from "@/lib/study/review-session";
import { studyVaultIndex } from "@/lib/study/vault";
import { studyTextRevision } from "@/lib/study/text-edits";
import { Button } from "@/components/panelui/button";
import { Card } from "@/components/panelui/card";
import { Tabs } from "@/components/panelui/tabs";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  startBookTutor,
  startCardTutor,
  startHighlightTutor,
  studyId,
  useStudyRecords,
} from "@/lib/db/study";
import { useNotes } from "@/lib/db/notes";
import { useSourceTitles } from "@/lib/db/sources";
import { currentVaultId, DEFAULT_VAULT, setCurrentVault } from "@/lib/db/vaults";
import type { Notebook, Vault } from "@/lib/db/types";
import {
  studyRatings,
  type StudyBook,
  type StudyRecord,
  type StudyThread,
} from "@/lib/study/records";
import { StudyLibrary } from "./study-library";
import { StudyReader } from "./study-reader";
import { CardLibrary, HighlightsLibrary, StudyReview } from "./study-review";
import { VocabularyLibrary } from "./study-vocabulary";
import { StudyTutor, TutorIndex } from "./study-tutor";

const tabs = ["today", "library", "cards", "review", "highlights", "vocabulary", "tutor"] as const;
type Tab = (typeof tabs)[number];

const wideReaderQuery = "(min-width: 64rem)";
const wideReader = () => window.matchMedia(wideReaderQuery).matches;
function subscribeReaderWidth(listener: () => void) {
  const query = window.matchMedia(wideReaderQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function DailyStudy({
  rows,
  books,
  vaultId,
  go,
  read,
  teachBack,
  practice,
  openingPractice,
}: {
  rows: StudyRecord[];
  books: StudyBook[];
  vaultId: string;
  go: (tab: Tab, params?: Record<string, string>) => void;
  read: (book: StudyBook) => void;
  teachBack: (book: StudyBook) => void;
  practice: (ids: string[]) => void;
  openingPractice: boolean;
}) {
  const { t } = useTranslation("home");
  const navigate = useNavigate();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const sessions = rows.filter((item) => item.kind === "session");
  const threads = rows.filter((item) => item.kind === "thread");
  const recentReport = threads
    .flatMap((thread) => (thread.report ? [{ thread, report: thread.report }] : []))
    .sort(
      (a, b) =>
        (b.report.generatedAt ?? b.thread.updatedAt) - (a.report.generatedAt ?? a.thread.updatedAt),
    )[0];
  const activity = sessions.filter((item) => item.updatedAt >= today.getTime());
  const dueCards = rows.filter((item) => item.kind === "card" && item.schedule.dueAt <= now).length;
  const dueHighlights = rows.filter(
    (item) => item.kind === "highlight" && item.schedule.dueAt <= now,
  ).length;
  const weakCards = weakStudyCards(rows);
  const paused = savedReview(vaultId);
  const resume =
    paused &&
    reviewQueue(
      reviewCollection(
        rows,
        new URLSearchParams(paused.path.split("?", 2)[1]),
        paused.state.studyReviewIds,
      ),
      paused.snapshot.practiced,
      now,
    ).length
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

  return (
    <section className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Today</h2>
          <p className="text-sm text-muted-foreground">
            {new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(today)}
          </p>
        </div>
        {streak ? (
          <p className="text-sm font-medium">{t("study.today.streak", { count: streak })}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {resume ? (
          <Button onClick={() => void navigate(resume.path, { state: resume.state })}>
            {t("study.today.resumeReview")}
          </Button>
        ) : null}
        {dueCards ? (
          <Button variant={resume ? "outline" : "default"} onClick={() => go("review")}>
            {t("study.today.cardsDue", { count: dueCards })}
          </Button>
        ) : null}
        {dueHighlights ? (
          <Button
            variant={resume || dueCards ? "outline" : "default"}
            onClick={() => go("review", { kind: "highlights" })}
          >
            {t("study.today.highlightsDue", { count: dueHighlights })}
          </Button>
        ) : null}
        <Button
          variant={resume || dueCards || dueHighlights ? "outline" : "default"}
          onClick={() => (lastRead ? read(lastRead) : go("library"))}
        >
          {lastRead ? "Continue reading" : "Add a document"}
        </Button>
        {lastRead ? (
          <Button variant="outline" onClick={() => teachBack(lastRead)}>
            Teach it back
          </Button>
        ) : null}
        {recentReport ? (
          <StudyOriginLink
            label={t("study.followUps.lastReport")}
            origin={{
              kind: "report",
              threadId: recentReport.thread.id,
              reportId: studyReportKey(recentReport.report),
            }}
          />
        ) : null}
      </div>
      <StudyFollowUps threads={threads} today={today.getTime()} vaultId={vaultId} />
      {activity.length ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ["Reading", "reading"],
              ["Review", "review"],
              ["Speaking", "speaking"],
            ] as const
          ).map(([label, key]) => (
            <Card size="sm" key={key}>
              <Card.Content>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {Math.floor(
                    activity
                      .filter((item) => item.activity === key)
                      .reduce((n, item) => n + item.seconds, 0) / 60,
                  )}{" "}
                  min
                </p>
              </Card.Content>
            </Card>
          ))}
        </div>
      ) : null}
      {lastRead ? (
        <div className="rounded-2xl border p-4">
          <p className="text-sm text-muted-foreground">Last opened</p>
          <p className="mt-1 font-medium" dir="auto">
            {lastRead.title}
          </p>
          <p className="text-sm text-muted-foreground">
            {lastRead.sections[lastRead.section]?.title}
          </p>
        </div>
      ) : null}
      {weakCards.length ? (
        <Card size="sm">
          <Card.Header className="flex flex-wrap items-center justify-between gap-2">
            <Card.Title>{t("study.recall.needsPractice")}</Card.Title>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => go("review", { mode: "weak" })}>
                {t("study.recall.practiceWeakCards", { count: weakCards.length })}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={openingPractice}
                onClick={() => practice(weakCards.map(({ card }) => card.id))}
              >
                {t("study.recall.tutorAction")}
              </Button>
            </div>
          </Card.Header>
          <Card.Content>
            <ul className="divide-y">
              {weakCards.slice(0, 3).map(({ card, rating }) => (
                <li
                  key={card.id}
                  className="flex min-w-0 flex-wrap items-center gap-x-3 py-2 text-sm"
                >
                  <span dir="auto" className="min-w-0 flex-1 wrap-break-word">
                    {card.front}
                  </span>
                  <span className="text-muted-foreground">
                    {t(`study.recall.rating.${rating}`)}
                  </span>
                  {card.origin ? <StudyOriginLink origin={card.origin} /> : null}
                </li>
              ))}
            </ul>
          </Card.Content>
        </Card>
      ) : null}
      {rows.length ? <StudyProgress rows={rows} books={books} now={now} /> : null}
      <div className="space-y-2">
        <h3 className="font-semibold">Recent activity</h3>
        {sessions.length ? (
          <ul className="divide-y rounded-2xl border">
            {sessions.slice(0, 10).map((session) => (
              <li key={session.id} className="flex flex-wrap justify-between gap-2 p-3 text-sm">
                <span className="capitalize">
                  {session.activity}
                  {session.rating ? ` · ${session.rating}` : ""}
                </span>
                {session.origin ? <StudyOriginLink origin={session.origin} /> : null}
                <span className="text-muted-foreground">
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(session.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Reading time and reviews appear here as you study.
          </p>
        )}
      </div>
    </section>
  );
}

function StudyProgress({
  rows,
  books,
  now,
}: {
  rows: StudyRecord[];
  books: StudyBook[];
  now: number;
}) {
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
    .filter((item) => item.itemId && currentCards.has(item.itemId))
    .slice(0, 20);
  const totals = [
    { label: "Flashcards", value: cards.length, tab: "cards" },
    { label: "Documents", value: books.length, tab: "library" },
    {
      label: "Highlights",
      value: rows.filter((item) => item.kind === "highlight").length,
      tab: "highlights",
    },
    {
      label: "Reviews",
      value: reviews.reduce((total, item) => total + item.count, 0),
      tab: "review",
    },
    {
      label: "Speaking sessions",
      value: speaking.reduce((total, item) => total + item.count, 0),
      tab: "tutor",
    },
    {
      label: "Speaking minutes",
      value: Math.round(speaking.reduce((total, item) => total + item.seconds, 0) / 60),
      tab: "tutor",
    },
  ];
  const reading = books.filter((book) => book.lastReadAt !== undefined || book.section > 0);
  return (
    <section className="space-y-3" aria-label="Study progress">
      <h3 className="font-semibold">Study progress</h3>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
        {totals.map(({ label, value, tab }, index) => (
          <div key={label} className="space-y-1 bg-card p-3">
            <dt className="text-sm text-muted-foreground">
              <Link to={studyHref(tab)} className="hover:underline">
                {label}
              </Link>
            </dt>
            <dd className="text-lg font-semibold tabular-nums">{value}</dd>
            {index >= 3 ? <p className="text-xs text-muted-foreground">Last 30 days</p> : null}
          </div>
        ))}
      </dl>
      {recentRecall.length ? (
        <div className="space-y-2 rounded-xl border p-3 text-sm">
          <h4 className="font-medium">Last {recentRecall.length} flashcard reviews</h4>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            {studyRatings.map((rating) => (
              <li key={rating}>
                {recentRecall.filter((item) => item.rating === rating).length} {rating}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {reading.length ? (
        <div className="space-y-2 rounded-xl border p-3">
          <h4 className="text-sm font-medium">Reading progress</h4>
          <ul className="space-y-3">
            {reading.map((book) => (
              <li key={book.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <Link
                    dir="auto"
                    to={studyHref("library", { book: book.id })}
                    className="truncate hover:underline"
                  >
                    {book.title}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {Math.round(((book.section + 1) / book.sections.length) * 100)}%
                  </span>
                </div>
                <progress
                  max={book.sections.length}
                  value={book.section + 1}
                  aria-label={`Reading progress for ${book.title}`}
                  className="block h-1 w-full accent-primary"
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export default function StudyWorkspace({
  vaultId,
  notebooks,
  vaults,
}: {
  vaultId: string;
  notebooks: Notebook[];
  vaults: Vault[];
}) {
  const { t } = useTranslation("home");
  const { t: tCommon } = useTranslation();
  const location = useLocation();
  const [readerViewport, setReaderViewport] = useState<HTMLDivElement | null>(null);
  const [params, setParams] = useSearchParams();
  const [settings, setSettings] = useState(false);
  const [openingPractice, setOpeningPractice] = useState(false);
  const [openingReaderTutor, setOpeningReaderTutor] = useState(false);
  const readerRequest = useRef<AbortController | null>(null);
  const readerCheckpoint = useRef<(() => void) | null>(null);
  const readerTrigger = useRef<HTMLElement | null>(null);
  const tutorPane = useRef<HTMLElement>(null);
  const wasShowingTutor = useRef(false);
  const sideBySide = useSyncExternalStore(subscribeReaderWidth, wideReader, () => false);
  const saved = useStudyRecords();
  const notes = useNotes();
  const tab: Tab = tabs.find((entry) => entry === params.get("tab")) ?? "today";
  const requestedReaderTutor = tab === "library" ? params.get("readerTutor") : null;
  const tutoring = tab === "tutor" || Boolean(requestedReaderTutor);
  const [directReviewId] = useState(() => {
    const id = studyId();
    return tab === "review" && location.key === "default"
      ? directReviewSession(location.pathname + location.search, id)
      : id;
  });
  const ready = saved !== undefined && notes !== undefined;
  const sourceTitles = useSourceTitles(tutoring);
  const selection = tab === "review" ? reviewSelection(location.state) : undefined;
  const scope = useMemo(
    () =>
      studyVaultIndex({
        rows: saved ?? [],
        notebooks,
        notes: notes ?? [],
        vaults,
        defaultVaultId: DEFAULT_VAULT,
      }),
    [saved, notebooks, notes, vaults],
  );
  const reviewVault = selection?.studyReviewVault;
  const linkedVault = ready
    ? ((reviewVault && vaults.some(({ id }) => id === reviewVault) ? reviewVault : undefined) ??
      scope.linkedVault(params))
    : undefined;
  const studyVaultId = linkedVault ?? vaultId;
  const rows = (saved ?? [])
    .filter((row) => scope.owner(row) === studyVaultId)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  useEffect(() => {
    if (linkedVault && linkedVault !== currentVaultId()) setCurrentVault(linkedVault);
  }, [linkedVault, location.key]);
  const books = rows.filter((row) => row.kind === "book");
  const cards = rows.filter((row) => row.kind === "card");
  const highlights = rows.filter((row) => row.kind === "highlight");
  const threads = rows.filter((row) => row.kind === "thread");
  const words = rows.filter((row) => row.kind === "word");
  const vaultNotes = (notes ?? []).filter((note) => scope.noteOwner(note.id) === studyVaultId);
  const notebookTitles = new Map(notebooks.map(({ id, title }) => [id, title]));
  const notebookSources = (sourceTitles ?? [])
    .filter(({ notebookId }) => scope.notebookOwner(notebookId) === studyVaultId)
    .map(({ id, title, notebookId }) => ({ id, title, detail: notebookTitles.get(notebookId) }));
  const bookTitles = new Map(books.map(({ id, title }) => [id, title]));
  const vaultHighlights = (tutoring ? highlights : []).flatMap((highlight) => {
    const detail = bookTitles.get(highlight.bookId);
    if (detail === undefined || !highlight.quote.trim()) return [];
    return [{
      id: highlight.id,
      title: studyHighlightPreview(highlight.quote),
      detail,
      searchText: `${highlight.quote} ${highlight.note} ${highlight.cue ?? ""}`,
    }];
  });
  const bookId = params.get("book");
  const book = books.find((entry) => entry.id === bookId);
  const readerThread =
    book && threads.find(({ id, bookId }) => id === requestedReaderTutor && bookId === book.id);
  const readerThreadId = readerThread?.id;
  const readingWithoutPane = params.get("readerView") === "book";
  const tutorVisible = Boolean(readerThreadId && (sideBySide || !readingWithoutPane));
  const unavailableBook = Boolean(ready && bookId && !book);
  const thread = threads.find((entry) => entry.id === params.get("thread"));
  const fromReport = params.get("fromReport");
  const reportFilter = fromReport && thread ? { thread: thread.id, fromReport } : undefined;
  const reportCollection = fromReport ? t("study.followUps.reportCards") : undefined;
  const page = queryIndex(params.get("page"));
  const at = queryIndex(params.get("at"));
  const length = queryIndex(params.get("length"));
  const revision = queryIndex(params.get("rev"));
  const focusedRange = at !== undefined && length ? { offset: at, length, revision } : undefined;
  const output = params.get("output");
  const cardId = params.get("card");
  const notebookId = params.get("notebook");
  const requestedReview = selection?.studyReviewIds;
  const reviewingHighlights = params.get("kind") === "highlights";
  const reviewingVocabulary = params.get("kind") === "vocabulary";
  const weakMode = tab === "review" && !reviewingHighlights && params.get("mode") === "weak";
  const filteredCards = studyCardsInScope(cards, params, book, thread?.id ?? null);
  const reviewSessionId =
    selection?.studyReviewSession ?? (location.key === "default" ? directReviewId : location.key);
  const filteredHighlights = book
    ? highlights.filter((item) => item.bookId === book.id)
    : highlights;
  const bookFilter = book ? { book: book.id } : undefined;
  const libraryScope = notebookId ? { notebook: notebookId } : undefined;
  const readerScope = readerThreadId
    ? {
        ...libraryScope,
        readerTutor: readerThreadId,
        ...(readingWithoutPane ? { readerView: "book" } : {}),
      }
    : libraryScope;
  const locate = (bookId: string, section: number) =>
    go("library", { ...readerScope, book: bookId, page: String(section) });

  useEffect(() => () => readerRequest.current?.abort(), [bookId, tab]);

  useEffect(() => {
    if (tutorVisible) tutorPane.current?.focus({ preventScroll: true });
    else if (wasShowingTutor.current) {
      const trigger = readerTrigger.current;
      const destination = trigger?.isConnected ? trigger : readerViewport?.querySelector("article");
      destination?.focus({ preventScroll: true });
      readerTrigger.current = null;
    }
    wasShowingTutor.current = tutorVisible;
  }, [readerThreadId, readerViewport, tutorVisible]);

  function go(next: Tab, extra?: Record<string, string>, review?: string[]) {
    setParams(
      { view: "study", tab: next, vault: studyVaultId, ...extra },
      {
        state:
          next === "review"
            ? { studyReviewIds: review, studyReviewVault: studyVaultId }
            : reviewReturnState(location.state),
      },
    );
  }
  function read(what: StudyBook) {
    go("library", { ...libraryScope, book: what.id });
  }
  function openThread(what: StudyThread) {
    go("tutor", { thread: what.id });
  }
  function showReaderTutor(id?: string, showBook = false) {
    readerCheckpoint.current?.();
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (id) next.set("readerTutor", id);
        else next.delete("readerTutor");
        if (id && showBook) next.set("readerView", "book");
        else next.delete("readerView");
        return next;
      },
      { replace: Boolean(requestedReaderTutor), state: reviewReturnState(location.state) },
    );
  }

  async function discussWhileReading(
    document: StudyBook,
    scope: "passage" | "chapter" | "book",
    section: number,
    selection?: { text: string; offset: number; revision: number },
    goal: StudyThread["goal"] = "book",
    initial?: StudyThread["messages"],
  ) {
    if (readerRequest.current) return;
    const active = window.document.activeElement;
    if (!readerThreadId && active instanceof HTMLElement && active !== window.document.body)
      readerTrigger.current = active;
    const existing =
      !initial &&
      threads.find(
        (candidate) =>
          candidate.bookId === document.id &&
          candidate.goal === goal &&
          candidate.scope === scope &&
          (scope === "book" || candidate.section === section) &&
          (scope !== "passage" ||
            (candidate.quote === selection?.text &&
              candidate.offset === selection?.offset &&
              candidate.revision === selection?.revision)),
      );
    if (existing) {
      showReaderTutor(existing.id);
      return;
    }
    const request = new AbortController();
    readerRequest.current = request;
    setOpeningReaderTutor(true);
    try {
      const created = await startBookTutor(
        document,
        {
          goal,
          scope,
          section,
          quote: selection?.text,
          offset: selection?.offset,
          revision: selection?.revision,
        },
        initial,
      );
      if (!request.signal.aborted) showReaderTutor(created.id);
    } catch (error) {
      if (!request.signal.aborted)
        toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      readerRequest.current = null;
      setOpeningReaderTutor(false);
    }
  }

  function openReadingPanel(what: StudyThread, document: StudyBook) {
    const target = new URLSearchParams(
      originHref(tutorBookOrigin(what, document)).split("?", 2)[1],
    );
    target.set("readerTutor", what.id);
    setParams(target, { state: reviewReturnState(location.state) });
  }

  function conversation(what: StudyThread, inReader = false) {
    const document = books.find((entry) => entry.id === what.bookId);
    return (
      <StudyTutor
        key={`${what.id}:${params.get("report") ?? ""}:${params.get("reportId") ?? ""}`}
        thread={what}
        vaultThreads={threads}
        vaultId={studyVaultId}
        vaultNotes={vaultNotes}
        vaultBooks={books}
        vaultHighlights={vaultHighlights}
        notebookSources={notebookSources}
        book={document}
        openReport={params.get("report") === "1"}
        requestedReportId={params.get("reportId") ?? undefined}
        reportCards={cards}
        focusMessage={queryIndex(params.get("message"))}
        back={inReader ? undefined : () => go("tutor")}
        openBesideReader={
          !inReader && document ? () => openReadingPanel(what, document) : undefined
        }
        setup={() => setSettings(true)}
      />
    );
  }
  async function openTutorSelection(
    kind: "card" | "highlight",
    ids: string[],
    state?: ReturnType<typeof reviewReturnState>,
  ) {
    if (openingPractice) return;
    setOpeningPractice(true);
    try {
      const thread = kind === "card"
        ? await startCardTutor(ids, studyVaultId, t("study.recall.tutorTitle"))
        : await startHighlightTutor(ids, studyVaultId, t("study.highlights.tutorTitle"));
      if (thread) {
        setParams({ view: "study", tab: "tutor", vault: studyVaultId, thread: thread.id }, {
          state: state ?? reviewReturnState(location.state),
        });
      } else toast.error(t(kind === "card" ? "study.materials.noCardsSelected" : "study.highlights.unavailable"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setOpeningPractice(false);
    }
  }
  async function createThread(
    what: StudyBook,
    scope: StudyThread["scope"],
    section: number,
    selection?: { text: string; offset: number; revision: number },
    goal: StudyThread["goal"] = "book",
  ) {
    try {
      const created = await startBookTutor(what, {
        goal,
        scope,
        section,
        quote: selection?.text,
        offset: selection?.offset,
        revision: selection?.revision,
      });
      openThread(created);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  const content = (
    <>
      {!ready ? (
        <p role="status" className="text-muted-foreground">
          {tCommon("status.loading")}
        </p>
      ) : null}
      {ready && tab === "today" ? (
        <DailyStudy
          rows={rows}
          books={books}
          vaultId={studyVaultId}
          go={go}
          read={read}
          teachBack={(item) =>
            void createThread(item, "chapter", item.section, undefined, "teach-back")
          }
          practice={(ids) => void openTutorSelection("card", ids)}
          openingPractice={openingPractice}
        />
      ) : null}
      {unavailableBook ? (
        <section className="space-y-3">
          <p role="status" className="text-sm text-muted-foreground">
            {t("study.reader.documentUnavailable")}
          </p>
          <Button variant="outline" size="sm" onClick={() => go("library", libraryScope)}>
            {t("study.tabs.library")}
          </Button>
        </section>
      ) : null}
      {ready && !unavailableBook && tab === "library" ? (
        book ? (
          <StudyReader
            key={book.id}
            book={book}
            viewport={readerViewport}
            vaultId={studyVaultId}
            requestedPage={page}
            reference={params.get("reference") === "1"}
            focusedHighlight={params.get("highlight") ?? undefined}
            focusedRange={focusedRange}
            highlights={highlights.filter((highlight) => highlight.bookId === book.id)}
            back={() => go("library", libraryScope)}
            openPage={(section) => locate(book.id, section)}
            resume={() => locate(book.id, book.section)}
            openPassage={(section, range) =>
              go("library", {
                ...readerScope,
                book: book.id,
                page: String(section),
                at: String(range.offset),
                length: String(range.length),
                rev: String(studyTextRevision(book)),
              })
            }
            startChat={(scope, section, selection, goal, initial) =>
              void discussWhileReading(book, scope, section, selection, goal, initial)
            }
            openingTutor={openingReaderTutor}
            layoutCheckpoint={readerCheckpoint}
          />
        ) : (
          <StudyLibrary
            books={notebookId ? books.filter((item) => item.notebookId === notebookId) : books}
            notebookId={notebookId}
            vaultId={studyVaultId}
            openBook={read}
          />
        )
      ) : null}
      {ready && !unavailableBook && tab === "cards" ? (
        <CardLibrary
          cards={filteredCards}
          vaultId={studyVaultId}
          practice={(ids) => void openTutorSelection("card", ids)}
          openingPractice={openingPractice}
          filter={
            reportCollection ??
            book?.title ??
            (output
              ? "Studio flashcards"
              : cardId
                ? "Selected flashcard"
                : notebookId
                  ? t("study.recall.notebookCards")
                  : undefined)
          }
          clearFilter={() => go("cards")}
          creation={
            output || cardId || fromReport
              ? false
              : book
                ? {
                    origin: { kind: "book", bookId: book.id, section: book.section },
                    notebookId: book.notebookId,
                    vaultId: studyVaultId,
                    tags: [book.title],
                  }
                : { notebookId: notebookId ?? undefined, vaultId: studyVaultId, tags: [] }
          }
          review={(ids) =>
            go(
              "review",
              {
                ...bookFilter,
                ...reportFilter,
                ...(notebookId ? { notebook: notebookId } : {}),
                ...(output ? { output } : {}),
                ...(cardId ? { card: cardId } : {}),
              },
              ids,
            )
          }
        />
      ) : null}
      {ready && !unavailableBook && tab === "review" ? (
        <StudyReview
          key={`${location.key}:${studyVaultId}`}
          vaultId={studyVaultId}
          items={reviewCollection(rows, params, requestedReview)}
          useHighlights={reviewingHighlights}
          books={books}
          words={words}
          threads={threads}
          practice={(item, state) => void openTutorSelection(item.kind, [item.id], state)}
          openingPractice={openingPractice}
          initialPractice={weakMode}
          sessionId={reviewSessionId}
          ratedInDatabase={
            rows.filter(
              (row) =>
                row.kind === "session" &&
                row.activity === "review" &&
                row.reviewSessionId === reviewSessionId,
            ).length
          }
          libraryHref={
            reviewingVocabulary
              ? studyHref("vocabulary", { vault: studyVaultId })
              : reviewingHighlights && book
              ? studyHref("highlights", { book: book.id })
              : reportFilter
                ? studyHref("cards", reportFilter)
                : undefined
          }
          libraryLabel={reviewingVocabulary ? t("study.vocabulary.open") : undefined}
          collection={
            weakMode
              ? t("study.recall.weakSet")
              : reviewingVocabulary
                ? t("study.tabs.vocabulary")
                : requestedReview
                ? t(
                    reviewingHighlights
                      ? "study.highlights.selection"
                      : "study.recall.cardSelection",
                    { count: new Set(requestedReview).size },
                  )
                : (reportCollection ?? book?.title)
          }
        />
      ) : null}
      {ready && !unavailableBook && tab === "highlights" ? (
        <HighlightsLibrary
          highlights={filteredHighlights}
          filter={book?.title}
          clearFilter={() => go("highlights")}
          locate={(item) =>
            go("library", { book: item.bookId, page: String(item.section), highlight: item.id })
          }
          review={(ids) => go("review", { kind: "highlights", ...bookFilter }, ids)}
          discuss={(ids) => void openTutorSelection("highlight", ids)}
          openingTutor={openingPractice}
        />
      ) : null}
      {ready && tab === "vocabulary" ? (
        <VocabularyLibrary
          key={params.get("word") ?? "vocabulary"}
          words={words}
          cards={cards}
          vaultId={studyVaultId}
          focusedWord={params.get("word") ?? undefined}
          review={(ids) => go("review", { kind: "vocabulary" }, ids)}
        />
      ) : null}
      {ready && tab === "tutor" ? (
        thread ? (
          conversation(thread)
        ) : (
          <TutorIndex
            books={books}
            notes={vaultNotes}
            vaultHighlights={vaultHighlights}
            cards={cards}
            notebookSources={notebookSources}
            threads={threads}
            vaultId={studyVaultId}
            open={openThread}
            practice={(ids) => void openTutorSelection("card", ids)}
            openingPractice={openingPractice}
          />
        )
      ) : null}
    </>
  );

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        const selected = tabs.find((entry) => entry === value);
        if (selected) go(selected);
      }}
      variant="underline"
      className="h-full min-h-0 gap-0 overflow-hidden rounded-3xl bg-card ring-1 ring-border"
    >
      <Tabs.List aria-label={t("study.sections")} className="shrink-0 px-2 sm:px-4">
        {tabs.map((entry) => (
          <Tabs.Trigger key={entry} value={entry}>
            {t(`study.tabs.${entry}`)}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {tabs.map((entry) => (
        <Tabs.Content key={entry} value={entry} className="flex min-h-0 flex-col">
          {entry === tab ? (
            <div className="relative flex min-h-0 flex-1">
              <div
                className="flex min-h-0 min-w-0 flex-1 flex-col"
                inert={tutorVisible && !sideBySide}
              >
                {readerThread && !tutorVisible ? (
                  <div className="border-b px-3 py-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => showReaderTutor(readerThread.id)}
                    >
                      {t("study.reader.backToTutor")}
                    </Button>
                  </div>
                ) : null}
                <ScrollArea
                  key={`${studyVaultId}:${book?.id ?? ""}:${thread?.id ?? ""}`}
                  className="min-h-0 min-w-0 flex-1"
                  viewportRef={entry === "library" && book ? setReaderViewport : undefined}
                >
                  <div className="mx-auto max-w-6xl px-4 pt-5 pb-8 sm:px-6">{content}</div>
                </ScrollArea>
              </div>
              {readerThread ? (
                <aside
                  ref={tutorPane}
                  tabIndex={-1}
                  aria-label={t("study.reader.tutorPane")}
                  className={`absolute inset-0 min-h-0 min-w-0 flex-col bg-card outline-none lg:relative lg:inset-auto lg:w-[min(46%,36rem)] lg:shrink-0 lg:border-s ${tutorVisible ? "flex" : "hidden"}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        sideBySide ? showReaderTutor() : showReaderTutor(readerThread.id, true)
                      }
                    >
                      {t(sideBySide ? "study.reader.closeTutor" : "study.reader.backToReading")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openThread(readerThread)}>
                      {t("study.reader.fullTutor")}
                    </Button>
                  </div>
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="p-3 sm:p-4">{conversation(readerThread, true)}</div>
                  </ScrollArea>
                </aside>
              ) : null}
            </div>
          ) : null}
        </Tabs.Content>
      ))}
      <SettingsSheet
        open={settings}
        onOpenChange={setSettings}
        page={settings ? "providers" : undefined}
        trigger={<button type="button" hidden aria-hidden tabIndex={-1} />}
      />
    </Tabs>
  );
}
