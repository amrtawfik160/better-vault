import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/panelui/button";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { subscriptionConnectionsAllowed } from "@/lib/ai/cliproxyapi-client";
import { putStudyRecords, studyId, useStudyRecords } from "@/lib/db/study";
import { routes } from "@/lib/routes";
import type { StudyBook, StudyRecord, StudyThread } from "@/lib/study/records";
import { StudyLibrary } from "./study-library";
import { StudyReader } from "./study-reader";
import { CardLibrary, HighlightsLibrary, StudyReview, VocabularyLibrary } from "./study-review";
import { StudyTutor, TutorIndex } from "./study-tutor";

const tabs = ["today", "library", "cards", "review", "highlights", "vocabulary", "tutor"] as const;
type Tab = (typeof tabs)[number];
const labels: Record<Tab, string> = {
  today: "Today",
  library: "Library",
  cards: "Flashcards",
  review: "Review",
  highlights: "Highlights",
  vocabulary: "Vocabulary",
  tutor: "Tutor",
};

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
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const sessions = rows.filter((item) => item.kind === "session");
  const activity = sessions.filter((item) => item.updatedAt >= today.getTime());
  const dueCards = rows.filter((item) => item.kind === "card" && item.schedule.dueAt <= now).length;
  const dueHighlights = rows.filter(
    (item) => item.kind === "highlight" && item.schedule.dueAt <= now,
  ).length;
  const lastRead = books[0];
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
        <p className="text-sm font-medium">{streak} day study streak</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["Reading", "reading"],
            ["Review", "review"],
            ["Speaking", "speaking"],
          ] as const
        ).map(([label, key]) => (
          <div className="rounded-2xl border bg-card p-4" key={key}>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-semibold">
              {Math.floor(
                activity
                  .filter((item) => item.activity === key)
                  .reduce((n, item) => n + item.seconds, 0) / 60,
              )}{" "}
              min
            </p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => go("review")}>{dueCards} flashcards due</Button>
        <Button variant="outline" onClick={() => go("review", { kind: "highlights" })}>
          {dueHighlights} highlights due
        </Button>
        <Button variant="outline" onClick={() => (lastRead ? read(lastRead) : go("library"))}>
          {lastRead ? "Continue reading" : "Add a document"}
        </Button>
        {lastRead ? (
          <Button variant="outline" onClick={() => teachBack(lastRead)}>
            Teach it back
          </Button>
        ) : null}
      </div>
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

export function StudyWorkspace() {
  const [params, setParams] = useSearchParams();
  const [settings, setSettings] = useState(false);
  const saved = useStudyRecords();
  const tab: Tab = tabs.find((entry) => entry === params.get("tab")) ?? "today";
  const rows = (saved ?? []).toSorted((a, b) => b.updatedAt - a.updatedAt);
  const books = rows.filter((row) => row.kind === "book");
  const cards = rows.filter((row) => row.kind === "card");
  const highlights = rows.filter((row) => row.kind === "highlight");
  const threads = rows.filter((row) => row.kind === "thread");
  const words = rows.filter((row) => row.kind === "word");
  const book = books.find((entry) => entry.id === params.get("book"));
  const thread = threads.find((entry) => entry.id === params.get("thread"));
  const pageValue = params.get("page");
  const page = pageValue && /^\d+$/.test(pageValue) ? Number(pageValue) : undefined;
  const locate = (bookId: string, section: number) =>
    go("library", { book: bookId, page: String(section) });

  function go(next: Tab, extra?: Record<string, string>) {
    setParams({ tab: next, ...extra });
  }
  function read(what: StudyBook) {
    go("library", { book: what.id });
  }
  function openThread(what: StudyThread) {
    go("tutor", { thread: what.id });
  }
  async function createThread(
    what: StudyBook,
    scope: StudyThread["scope"],
    section: number,
    quote?: string,
    goal: StudyThread["goal"] = "book",
  ) {
    const item: StudyThread = {
      id: studyId(),
      kind: "thread",
      title: goal === "teach-back" ? `Teach it back · ${what.title}` : what.title,
      goal,
      scope,
      corrections: "off",
      notebookId: what.notebookId,
      bookId: what.id,
      section,
      quote,
      messages: [],
      updatedAt: Date.now(),
    };
    try {
      await putStudyRecords(item);
      openThread(item);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <header data-window-bar className="sticky top-0 z-20 border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-7">
          <Link
            to={routes.home}
            className="flex items-center gap-2 rounded-lg text-sm font-semibold focus-visible:outline-2"
          >
            <Logo size={22} /> deepLe
          </Link>
          <h1 className="text-sm font-medium text-muted-foreground">Study</h1>
          <div className="ms-auto">
            <SettingsSheet
              open={settings}
              onOpenChange={setSettings}
              page={
                settings ? (subscriptionConnectionsAllowed() ? "subscriptions" : "providers") : null
              }
            />
          </div>
          <nav aria-label="Study sections" className="flex w-full gap-1 overflow-x-auto pb-1">
            {tabs.map((entry) => (
              <button
                key={entry}
                type="button"
                aria-current={entry === tab ? "page" : undefined}
                onClick={() => go(entry)}
                className={`shrink-0 cursor-pointer rounded-lg px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${entry === tab ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >
                {labels[entry]}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-7">
        {!saved ? (
          <p role="status" className="text-muted-foreground">
            Loading study data…
          </p>
        ) : null}
        {saved && tab === "today" ? (
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
        {saved && tab === "library" ? (
          book ? (
            <StudyReader
              key={book.id}
              book={book}
              requestedPage={page}
              focusedHighlight={params.get("highlight") ?? undefined}
              highlights={highlights.filter((highlight) => highlight.bookId === book.id)}
              back={() => go("library")}
              openPage={(section) => locate(book.id, section)}
              startChat={(scope, section, quote) => void createThread(book, scope, section, quote)}
            />
          ) : (
            <StudyLibrary books={books} openBook={read} />
          )
        ) : null}
        {saved && tab === "cards" ? <CardLibrary cards={cards} /> : null}
        {saved && tab === "review" ? (
          <StudyReview
            key={params.get("kind")}
            cards={cards}
            highlights={highlights}
            useHighlights={params.get("kind") === "highlights"}
          />
        ) : null}
        {saved && tab === "highlights" ? (
          <HighlightsLibrary
            highlights={highlights}
            locate={(item) =>
              go("library", { book: item.bookId, page: String(item.section), highlight: item.id })
            }
            review={() => go("review", { kind: "highlights" })}
          />
        ) : null}
        {saved && tab === "vocabulary" ? <VocabularyLibrary words={words} /> : null}
        {saved && tab === "tutor" ? (
          thread ? (
            <StudyTutor
              key={thread.id}
              thread={thread}
              book={books.find((item) => item.id === thread.bookId)}
              locate={locate}
              back={() => go("tutor")}
              setup={() => setSettings(true)}
            />
          ) : (
            <TutorIndex books={books} threads={threads} open={openThread} />
          )
        ) : null}
      </main>
    </div>
  );
}
