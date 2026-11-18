import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { StudyOriginLink } from "./study-origin-link";
import { StudyFollowUps } from "./study-follow-ups";
import { queryIndex, studyHref } from "@/lib/study/links";
import { weakStudyCards } from "@/lib/study/recall";
import { matchesStudyReport, studyReportKey } from "@/lib/study/reports";
import { reviewReturnState, reviewSelection } from "@/lib/study/review-session";
import { studyVaultIndex } from "@/lib/study/vault";
import { studyTextRevision } from "@/lib/study/text-edits";
import { Button } from "@/components/panelui/button";
import { Card } from "@/components/panelui/card";
import { Tabs } from "@/components/panelui/tabs";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { startBookTutor, useStudyRecords } from "@/lib/db/study";
import { useNotes } from "@/lib/db/notes";
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
import { CardLibrary, HighlightsLibrary, StudyReview, VocabularyLibrary } from "./study-review";
import { StudyTutor, TutorIndex } from "./study-tutor";

const tabs = ["today", "library", "cards", "review", "highlights", "vocabulary", "tutor"] as const;
type Tab = (typeof tabs)[number];

function DailyStudy({
  rows,
  books,
  go,
  read,
  teachBack,
}: {
  rows: StudyRecord[];
  books: StudyBook[];
  go: (tab: Tab, params?: Record<string, string>) => void;
  read: (book: StudyBook) => void;
  teachBack: (book: StudyBook) => void;
}) {
  const { t } = useTranslation("home");
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
        {dueCards ? (
          <Button onClick={() => go("review")}>
            {t("study.today.cardsDue", { count: dueCards })}
          </Button>
        ) : null}
        {dueHighlights ? (
          <Button
            variant={dueCards ? "outline" : "default"}
            onClick={() => go("review", { kind: "highlights" })}
          >
            {t("study.today.highlightsDue", { count: dueHighlights })}
          </Button>
        ) : null}
        <Button
          variant={dueCards || dueHighlights ? "outline" : "default"}
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
      <StudyFollowUps threads={threads} today={today.getTime()} />
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
            <Button variant="outline" size="sm" onClick={() => go("review", { mode: "weak" })}>
              {t("study.recall.practiceWeakCards", { count: weakCards.length })}
            </Button>
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
  const [params, setParams] = useSearchParams();
  const [settings, setSettings] = useState(false);
  const saved = useStudyRecords();
  const notes = useNotes();
  const ready = saved !== undefined && notes !== undefined;
  const tab: Tab = tabs.find((entry) => entry === params.get("tab")) ?? "today";
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
    ? (scope.linkedVault(params) ??
      (reviewVault && vaults.some(({ id }) => id === reviewVault) ? reviewVault : undefined))
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
  const bookId = params.get("book");
  const book = books.find((entry) => entry.id === bookId);
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
  const weakMode = tab === "review" && params.get("mode") === "weak";
  const reviewIds = weakMode
    ? new Set(weakStudyCards(rows).map(({ card }) => card.id))
    : requestedReview
      ? new Set(requestedReview)
      : null;
  const filteredCards = cards.filter(
    (row) =>
      (!book ||
        (row.origin?.kind === "book"
          ? row.origin.bookId === book.id
          : row.notebookId === book.notebookId)) &&
      (!notebookId || row.notebookId === notebookId) &&
      (!output || (row.origin?.kind === "studio" && row.origin.outputId === output)) &&
      (!fromReport || matchesStudyReport(row.origin, thread?.id ?? null, fromReport)) &&
      (!cardId || row.id === cardId),
  );
  const filteredHighlights = book
    ? highlights.filter((item) => item.bookId === book.id)
    : highlights;
  const bookFilter = book ? { book: book.id } : undefined;
  const libraryScope = notebookId ? { notebook: notebookId } : undefined;
  const locate = (bookId: string, section: number) =>
    go("library", { ...libraryScope, book: bookId, page: String(section) });

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
          go={go}
          read={read}
          teachBack={(item) =>
            void createThread(item, "chapter", item.section, undefined, "teach-back")
          }
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
            requestedPage={page}
            focusedHighlight={params.get("highlight") ?? undefined}
            focusedRange={focusedRange}
            highlights={highlights.filter((highlight) => highlight.bookId === book.id)}
            back={() => go("library", libraryScope)}
            openPage={(section) => locate(book.id, section)}
            openPassage={(section, range) =>
              go("library", {
                ...libraryScope,
                book: book.id,
                page: String(section),
                at: String(range.offset),
                length: String(range.length),
                rev: String(studyTextRevision(book)),
              })
            }
            startChat={(scope, section, selection, goal) =>
              void createThread(book, scope, section, selection, goal)
            }
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
          key={location.key}
          vaultId={studyVaultId}
          cards={reviewIds ? filteredCards.filter(({ id }) => reviewIds.has(id)) : filteredCards}
          highlights={filteredHighlights}
          useHighlights={params.get("kind") === "highlights"}
          books={books}
          initialPractice={weakMode}
          libraryHref={reportFilter ? studyHref("cards", reportFilter) : undefined}
          collection={
            weakMode
              ? t("study.recall.weakSet")
              : reviewIds
                ? t("study.recall.cardSelection", { count: reviewIds.size })
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
          review={() => go("review", { kind: "highlights", ...bookFilter })}
        />
      ) : null}
      {ready && tab === "vocabulary" ? (
        <VocabularyLibrary words={words} focusedWord={params.get("word") ?? undefined} />
      ) : null}
      {ready && tab === "tutor" ? (
        thread ? (
          <StudyTutor
            key={`${thread.id}:${params.get("report") ?? ""}:${params.get("reportId") ?? ""}`}
            thread={thread}
            vaultId={studyVaultId}
            vaultNotes={(notes ?? []).filter((note) => scope.noteOwner(note.id) === studyVaultId)}
            book={books.find((item) => item.id === thread.bookId)}
            openReport={params.get("report") === "1"}
            requestedReportId={params.get("reportId") ?? undefined}
            reportCards={cards}
            focusMessage={queryIndex(params.get("message"))}
            back={() => go("tutor")}
            setup={() => setSettings(true)}
          />
        ) : (
          <TutorIndex books={books} threads={threads} vaultId={studyVaultId} open={openThread} />
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
            <ScrollArea
              key={`${studyVaultId}:${book?.id ?? ""}:${thread?.id ?? ""}`}
              className="min-h-0 flex-1"
            >
              <div className="mx-auto max-w-6xl px-4 pt-5 pb-8 sm:px-6">{content}</div>
            </ScrollArea>
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
