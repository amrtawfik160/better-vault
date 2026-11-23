import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  isFocusedStudyReader,
  originHref,
  queryIndex,
  studyCollectionHref,
  studyHref,
  studyLocation,
  studyTabs as tabs,
  studyVisualFromReader,
  type StudyTab as Tab,
} from "@/lib/study/links";
import { readerThreadHref, threadReaderBook } from "@/lib/study/practice";
import { captureStudyImage, type StudyImageCapture } from "@/lib/study/visual-card";
import { studyHighlightPreview } from "@/lib/study/recall";
import { scanDraftId } from "@/lib/study/ocr-write";
import { studyCollection } from "@/lib/study/collection";
import {
  dailyReview,
  directReviewSession,
  reviewCollection,
  reviewSelection,
  type ReviewTutorFeedback,
} from "@/lib/study/review-session";
import { studyReturnState, tutorReturnState } from "@/lib/study/return-links";
import { studyVaultIndex } from "@/lib/study/vault";
import { sharedStudyVault, studyVaultViews } from "@/lib/study/review-vaults";
import { useSettings } from "@/lib/db/settings";
import { useVaultName } from "@/components/home/vault-name";
import { studyTextRevision } from "@/lib/study/text-edits";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/panelui/button";
import { Tabs } from "@/components/panelui/tabs";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  startBookTutor,
  startBookImageTutor,
  startCardTutor,
  startHighlightTutor,
  studyId,
  useStudyRecords,
} from "@/lib/db/study";
import { useNotes } from "@/lib/db/notes";
import { useOutput } from "@/lib/db/outputs";
import { useSourceTitles } from "@/lib/db/sources";
import { currentVaultId, DEFAULT_VAULT, setCurrentVault } from "@/lib/db/vaults";
import type { Notebook, Vault } from "@/lib/db/types";
import { studyHighlightColor, type StudyBook, type StudyThread } from "@/lib/study/records";
import { StudyCollection, type StudyCollectionChip } from "./study-collection";
import { StudyLibrary } from "./study-library";
import { StudyOriginLink } from "./study-origin-link";
import { StudyReader } from "./study-reader";
import { StudyReview } from "./study-review";
import { DailyStudy } from "./study-today";
import { StudyPracticeTab } from "./study-practice-tab";
import { StudyTutor } from "./study-tutor";
import { useStudyClock } from "./use-study-clock";
import { StudyVaultScopeContext, type StudyVaultScope } from "./study-vault-scope";
import { useStudyReaderFullscreen } from "./use-study-reader-fullscreen";

const wideReaderQuery = "(min-width: 64rem)";
const wideReader = () => window.matchMedia(wideReaderQuery).matches;
function subscribeReaderWidth(listener: () => void) {
  const query = window.matchMedia(wideReaderQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
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
  const focusedReader = isFocusedStudyReader(params);
  const enterFullscreen = useStudyReaderFullscreen(focusedReader, () => changeReaderFocus(false));
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
  const { tab, filter: collectionFilter } = studyLocation(params);
  const requestedReaderTutor = tab === "library" ? params.get("readerTutor") : null;
  const tutoring = tab === "practice" || Boolean(requestedReaderTutor);
  const [directReviewId] = useState(() => {
    const id = studyId();
    return tab === "review" && location.key === "default"
      ? directReviewSession(location.pathname + location.search, id)
      : id;
  });
  const ready = saved !== undefined && notes !== undefined;
  const sourceTitles = useSourceTitles(tutoring, true);
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
  const acrossVaults = Boolean(useSettings()?.study?.reviewAcrossVaults);
  const vaultName = useVaultName();
  const views = studyVaultViews(
    (saved ?? [])
      .filter((row) => row.kind !== "document-draft" && row.kind !== "ocr-draft")
      .sort((a, b) => b.updatedAt - a.updatedAt),
    scope.owner,
    studyVaultId,
    acrossVaults,
  );
  const rows = views.rows;
  const review = {
    books: views.review.filter((row) => row.kind === "book"),
    cards: views.review.filter((row) => row.kind === "card"),
    highlights: views.review.filter((row) => row.kind === "highlight"),
    words: views.review.filter((row) => row.kind === "word"),
  };
  const vaultScope: StudyVaultScope = {
    acrossVaults,
    vaultOf: scope.owner,
    label: (row) =>
      acrossVaults ? vaultName(vaults.find(({ id }) => id === scope.owner(row)) ?? { name: "" }) : undefined,
  };

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
  const scanDraft = book && saved?.find((row) => row.id === scanDraftId(book.id));
  const readerThread =
    book && threads.find(({ id, bookId }) => id === requestedReaderTutor && bookId === book.id);
  const readerThreadId = readerThread?.id;
  const readingWithoutPane = params.get("readerView") === "book";
  const tutorVisible = Boolean(readerThreadId && (sideBySide || !readingWithoutPane));
  const unavailableBook = Boolean(ready && bookId && !book);
  const readingBook = ready && tab === "library" && Boolean(book);
  const outsideReader = useRef<string | null>(null);
  const thread = threads.find((entry) => entry.id === params.get("thread"));
  const fromAnswer = params.get("fromAnswer");
  const answerIndex = queryIndex(fromAnswer);
  const fromThread = params.get("fromThread") === "1" ? "1" : undefined;
  const answerFilter: Record<string, string> | undefined = fromAnswer !== null && thread
    ? { thread: thread.id, fromAnswer }
    : fromThread && thread ? { thread: thread.id, fromThread } : undefined;
  const answerCollection = fromAnswer !== null
    ? t("study.recall.tutorAnswerCards")
    : fromThread ? t("study.tutorActions.conversationCards") : undefined;
  const tutorAnswer = answerIndex !== undefined && thread?.messages[answerIndex]?.role === "assistant" &&
    !tutorReturnState(location.state) ? { threadId: thread.id, message: answerIndex } : undefined;
  const fromReport = params.get("fromReport");
  const reportFilter = fromReport && thread ? { thread: thread.id, fromReport } : undefined;
  const reportCollection = fromReport ? t("study.followUps.reportCards") : undefined;
  const page = queryIndex(params.get("page"));
  const at = queryIndex(params.get("at"));
  const length = queryIndex(params.get("length"));
  const revision = queryIndex(params.get("rev"));
  const focusedVisual = studyVisualFromReader(params, book?.format);
  const focusedRange = at !== undefined && length ? { offset: at, length, revision } : undefined;
  const output = params.get("output");
  const studioOutput = useOutput(tab === "review" ? output : null);
  const studioReturn =
    studioOutput?.id === output &&
    (studioOutput.toolId === "quiz" || studioOutput.toolId === "flashcards") &&
    scope.notebookOwner(studioOutput.notebookId) === studyVaultId
      ? {
          href: originHref({
            kind: "studio",
            notebookId: studioOutput.notebookId,
            outputId: studioOutput.id,
          }),
          label: t(
            studioOutput.toolId === "quiz" ? "study.recall.backToQuiz" : "study.recall.backToStudioCards",
          ),
        }
      : undefined;
  const cardId = params.get("card");
  const noteId = params.get("note");
  const noteFilter = noteId ? { note: noteId } : undefined;
  const collectionNote = vaultNotes.find(({ id }) => id === noteId);
  const noteCollection = noteId
    ? (collectionNote?.title ?? t("study.recall.noteCards"))
    : undefined;
  const notebookId = params.get("notebook");
  const requestedReview = selection?.studyReviewIds;
  const reviewingHighlights = params.get("kind") === "highlights";
  const reviewingVocabulary = params.get("kind") === "vocabulary";
  const weakMode = tab === "review" && params.get("mode") === "weak";
  const practiceMode = tab === "review" && params.get("mode") === "practice";
  const reviewSessionId =
    selection?.studyReviewSession ?? (location.key === "default" ? directReviewId : location.key);
  const now = useStudyClock([...review.cards, ...review.highlights]);
  const dueNow = dailyReview(views.review, now).due.length;
  const collected = tab === "collection" ? studyCollection(views.collection, params) : undefined;
  const lastRead =
    books.filter((entry) => entry.lastReadAt !== undefined).toSorted((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0];
  const bookFilter = book ? { book: book.id } : undefined;
  const reviewKind = params.get("kind");
  const reviewScope: Record<string, string> = {
    ...bookFilter,
    ...reportFilter,
    ...answerFilter,
    ...noteFilter,
    ...(notebookId ? { notebook: notebookId } : {}),
    ...(output ? { output } : {}),
    ...(cardId ? { card: cardId } : {}),
  };
  const highlightColor = studyHighlightColor.safeParse(params.get("color")).data;
  const collectionChips: StudyCollectionChip[] = [
    book ? { key: "book", label: book.title } : undefined,
    notebookId
      ? { key: "notebook", label: notebookTitles.get(notebookId) ?? t("study.recall.notebookCards") }
      : undefined,
    noteCollection ? { key: "note", label: noteCollection } : undefined,
    output ? { key: "output", label: t("study.collection.scopes.output") } : undefined,
    cardId ? { key: "card", label: t("study.collection.scopes.card") } : undefined,
    reportCollection ? { key: "fromReport", label: reportCollection } : undefined,
    answerCollection ? { key: fromAnswer !== null ? "fromAnswer" : "fromThread", label: answerCollection } : undefined,
    highlightColor ? { key: "color", label: t(`study.highlights.colors.${highlightColor}`) } : undefined,
  ].filter((chip) => chip !== undefined);
  function changeCollection(update: (query: URLSearchParams) => void) {
    const query = new URLSearchParams(params);
    query.set("tab", "collection");
    if (collectionFilter === "all") query.delete("filter");
    else query.set("filter", collectionFilter);
    update(query);
    setParams(query, { replace: true, state: studyReturnState(location.state) });
  }
  const libraryScope = notebookId ? { notebook: notebookId } : undefined;
  const readerScope = {
    ...libraryScope,
    ...(readerThreadId ? {
      readerTutor: readerThreadId,
      ...(readingWithoutPane ? { readerView: "book" } : {}),
    } : {}),
    ...(focusedReader ? { readerFocus: "1" } : {}),
  };
  const locate = (bookId: string, section: number) =>
    go("library", { ...readerScope, book: bookId, page: String(section) });

  useEffect(() => () => readerRequest.current?.abort(), [bookId, tab]);

  // The reader's back button returns to the Study view the book was opened from.
  useEffect(() => {
    if (!bookId) outsideReader.current = location.search;
  }, [bookId, location.search]);

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
            ? {
                ...(extra?.fromAnswer !== undefined || extra?.fromReport !== undefined ? studyReturnState(location.state) : undefined),
                studyReviewIds: review,
                studyReviewVault: studyVaultId,
              }
            : studyReturnState(location.state),
      },
    );
  }
  function changeReaderFocus(next: boolean) {
    if (next === focusedReader) return;
    readerCheckpoint.current?.();
    setParams((current) => {
      const query = new URLSearchParams(current);
      if (next) query.set("readerFocus", "1");
      else query.delete("readerFocus");
      return query;
    }, { replace: true, state: studyReturnState(location.state) });
    if (next) enterFullscreen();
  }
  function leaveReader() {
    const previous = outsideReader.current;
    if (previous) setParams(new URLSearchParams(previous), { state: studyReturnState(location.state) });
    else go("library", libraryScope);
  }
  function read(what: StudyBook) {
    go("library", { ...libraryScope, book: what.id });
  }
  /** Shows a thread on the Practice tab, as a page of its own. */
  function openThread(what: StudyThread) {
    go("practice", { thread: what.id });
  }
  /** Opens a question about a document beside it in the reader's Ask AI panel; anything else on Practice. */
  function openConversation(what: StudyThread) {
    const document = threadReaderBook(what, books);
    if (document) openReadingPanel(what, document);
    else openThread(what);
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
      { replace: Boolean(requestedReaderTutor), state: studyReturnState(location.state) },
    );
  }

  async function openTutorWhileReading(open: () => Promise<StudyThread>) {
    if (readerRequest.current) return false;
    const active = window.document.activeElement;
    if (!readerThreadId && active instanceof HTMLElement && active !== window.document.body)
      readerTrigger.current = active;
    const request = new AbortController();
    readerRequest.current = request;
    setOpeningReaderTutor(true);
    try {
      const thread = await open();
      if (request.signal.aborted) return false;
      showReaderTutor(thread.id);
      return true;
    } catch (error) {
      if (!request.signal.aborted)
        toast.error(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      readerRequest.current = null;
      setOpeningReaderTutor(false);
    }
  }

  function discussImage(document: StudyBook, section: number, capture: StudyImageCapture) {
    return openTutorWhileReading(async () => {
      const snapshot = await captureStudyImage(capture).catch(() => undefined);
      if (!snapshot) throw new Error(t("study.reader.imageCaptureFailed"));
      return startBookImageTutor(document, section, snapshot);
    });
  }

  function discussWhileReading(
    document: StudyBook,
    scope: "passage" | "chapter" | "book",
    section: number,
    selection?: { text: string; offset: number; revision: number },
    goal: StudyThread["goal"] = "book",
    initial?: StudyThread["messages"],
  ) {
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
    return openTutorWhileReading(async () => existing || startBookTutor(
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
      ));
  }

  function openReadingPanel(what: StudyThread, document: StudyBook) {
    const target = new URLSearchParams(readerThreadHref(what, document).split("?", 2)[1]);
    target.set("vault", studyVaultId);
    setParams(target, { state: studyReturnState(location.state) });
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
        focusSuggestion={params.get("suggestion") ?? undefined}
        reportCards={cards}
        vaultWords={words}
        focusMessage={queryIndex(params.get("message"))}
        back={inReader ? undefined : () => go("practice")}
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
    state?: ReturnType<typeof studyReturnState>,
    feedback?: ReviewTutorFeedback,
  ) {
    if (openingPractice) return;
    setOpeningPractice(true);
    try {
      const draft = feedback ? { id: studyId(), text: feedback.text, at: Date.now() } : undefined;
      const itemsVault = sharedStudyVault(ids, views.review, scope.owner, studyVaultId);
      const thread = kind === "card"
        ? await startCardTutor(ids, itemsVault, t("study.recall.tutorTitle"), draft, feedback?.threadId)
        : await startHighlightTutor(ids, itemsVault, t("study.highlights.tutorTitle"), draft, feedback?.threadId);
      if (thread) {
        const returnState = state ?? studyReturnState(location.state);
        setParams(
          {
            view: "study",
            tab: "practice",
            vault: itemsVault,
            thread: thread.id,
            ...(feedback && tab === "today" ? { fromToday: "1" } : {}),
          },
          { state: feedback ? { ...returnState, studyReviewFeedback: true } : returnState },
        );
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
      openConversation(created);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  const content = (
    <StudyVaultScopeContext value={vaultScope}>
      {!ready ? (
        <p role="status" className="text-muted-foreground">
          {tCommon("status.loading")}
        </p>
      ) : null}
      {ready && tab === "today" ? (
        <DailyStudy
          rows={rows}
          review={views.review}
          books={books}
          notebookTitles={notebookTitles}
          vaultId={studyVaultId}
          go={go}
          read={read}
          askChapter={(item) => void createThread(item, "chapter", item.section)}
          teachBack={(item) =>
            void createThread(item, "chapter", item.section, undefined, "teach-back")
          }
          practice={(kind, ids, feedback) => void openTutorSelection(kind, ids, undefined, feedback)}
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
            scanDraft={scanDraft?.kind === "ocr-draft" && scanDraft.fileId === book.fileId ? scanDraft : undefined}
            viewport={readerViewport}
            vaultId={studyVaultId}
            requestedPage={page}
            reference={params.get("reference") === "1"}
            focusedHighlight={params.get("highlight") ?? undefined}
            focusedRange={focusedRange}
            focusedVisual={focusedVisual}
            highlights={highlights.filter((highlight) => highlight.bookId === book.id)}
            words={words.filter((word) => word.bookId === book.id)}
            viewportRef={setReaderViewport}
            wide={sideBySide}
            tutorPane={tutorPane}
            tutor={readerThread ? {
              thread: readerThread,
              visible: tutorVisible,
              content: conversation(readerThread, true),
              show: () => showReaderTutor(readerThread.id),
              hide: () => (sideBySide ? showReaderTutor() : showReaderTutor(readerThread.id, true)),
              openFull: () => openThread(readerThread),
            } : undefined}
            conversations={{
              threads: threads.filter((entry) => entry.bookId === book.id),
              open: (entry) => showReaderTutor(entry.id),
              leave: () => showReaderTutor(),
            }}
            reviewHighlights={() => go("review", { kind: "highlights", book: book.id })}
            reviewWords={(ids) => go("review", { kind: "vocabulary" }, ids)}
            back={leaveReader}
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
            startImageChat={(section, capture) => discussImage(book, section, capture)}
            openingTutor={openingReaderTutor}
            layoutCheckpoint={readerCheckpoint}
            focused={focusedReader}
            toggleFocus={() => changeReaderFocus(!focusedReader)}
          />
        ) : (
          <StudyLibrary
            books={notebookId ? books.filter((item) => item.notebookId === notebookId) : books}
            highlights={highlights}
            notebookTitles={notebookTitles}
            notebookId={notebookId}
            vaultId={studyVaultId}
            openBook={read}
          />
        )
      ) : null}
      {ready && !unavailableBook && collected ? (
        <StudyCollection
          key={studyVaultId}
          filter={collectionFilter}
          onFilterChange={(next) =>
            changeCollection((query) => {
              if (next === "all") query.delete("filter");
              else query.set("filter", next);
            })
          }
          cards={collected.cards}
          highlights={collected.highlights}
          words={collected.words}
          allCards={review.cards}
          books={review.books}
          vaultId={studyVaultId}
          chips={collectionChips}
          clearChip={(key) =>
            changeCollection((query) => {
              query.delete(key);
              if (key === "fromReport" || key === "fromAnswer" || key === "fromThread") query.delete("thread");
            })
          }
          clearChips={() => go("collection", collectionFilter === "all" ? undefined : { filter: collectionFilter })}
          links={
            noteId || tutorAnswer ? (
              <>
                {noteId ? <StudyOriginLink origin={{ kind: "note", noteId }} label={t("study.recall.backToNote")} /> : null}
                {tutorAnswer ? (
                  <StudyOriginLink origin={{ kind: "tutor", ...tutorAnswer }} label={t("study.recall.openTutorAnswer")} />
                ) : null}
              </>
            ) : undefined
          }
          focusedWord={params.get("word") ?? undefined}
          creation={
            output || cardId || fromReport || fromAnswer !== null || fromThread || noteId
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
          review={(kind, ids, practiceOnly) =>
            go(
              "review",
              {
                ...reviewScope,
                ...(kind ? { kind } : {}),
                ...(practiceOnly ? { mode: "practice" } : {}),
              },
              ids,
            )
          }
          practiceCards={(ids) => void openTutorSelection("card", ids)}
          discussHighlights={(ids) => void openTutorSelection("highlight", ids)}
          openingPractice={openingPractice}
          locate={(item) =>
            go("library", { book: item.bookId, page: String(item.section), highlight: item.id })
          }
          color={highlightColor}
          onColorChange={(next) =>
            changeCollection((query) => {
              if (next) query.set("color", next);
              else query.delete("color");
            })
          }
        />
      ) : null}
      {ready && !unavailableBook && tab === "review" ? (
        <StudyReview
          key={`${location.key}:${studyVaultId}`}
          vaultId={studyVaultId}
          items={reviewCollection(views.review, params, requestedReview)}
          useHighlights={reviewingHighlights}
          books={review.books}
          words={review.words}
          threads={threads}
          practice={(item, state, feedback) => void openTutorSelection(item.kind, [item.id], state, feedback)}
          practiceDifficult={(ids) =>
            go("review", { ...Object.fromEntries(params), vault: studyVaultId, mode: "weak" }, ids)
          }
          openingPractice={openingPractice}
          initialPractice={weakMode || practiceMode}
          sessionId={reviewSessionId}
          history={views.review.filter((row) => row.kind === "session")}
          continueReading={lastRead}
          collectionSource={studioReturn ?? (tutorAnswer ? {
            href: originHref({ kind: "tutor", ...tutorAnswer }),
            label: t("study.recall.openTutorAnswer"),
          } : undefined)}
          libraryHref={
            reviewingVocabulary || Object.keys(reviewScope).length
              ? studyCollectionHref(
                  reviewingHighlights
                    ? "highlights"
                    : reviewingVocabulary
                      ? "words"
                      : reviewKind === "cards" || noteFilter || output || cardId || reportFilter || answerFilter
                        ? "cards"
                        : "all",
                  { ...reviewScope, vault: studyVaultId },
                )
              : undefined
          }
          libraryLabel={reviewingVocabulary ? t("study.vocabulary.open") : undefined}
          collection={
            weakMode
              ? t(reviewingHighlights ? "study.recall.weakHighlights" : reviewKind === "cards" ? "study.recall.weakSet" : "study.review.weakItems")
              : reviewingVocabulary
                ? t("study.collection.filters.words")
                : (answerCollection ?? reportCollection ?? noteCollection ?? book?.title ??
                  (requestedReview
                    ? t(
                        reviewingHighlights
                          ? "study.highlights.selection"
                          : reviewKind === "cards"
                            ? "study.recall.cardSelection"
                            : "study.review.selection",
                        { count: new Set(requestedReview).size },
                      )
                    : undefined))
          }
        />
      ) : null}
      {ready && tab === "practice" ? (
        thread ? (
          <>
            {params.get("fromToday") === "1" ? (
              <Link
                to={studyHref("today", { vault: studyVaultId })}
                className={buttonVariants({ variant: "ghost", size: "sm", className: "mb-2" })}
              >
                {t("study.recall.backToToday")}
              </Link>
            ) : null}
            {conversation(thread)}
          </>
        ) : (
          <StudyPracticeTab
            books={books}
            notes={vaultNotes}
            vaultHighlights={vaultHighlights}
            cards={cards}
            notebookSources={notebookSources}
            threads={threads}
            vaultId={studyVaultId}
            open={openConversation}
            practice={(ids) => void openTutorSelection("card", ids)}
            openingPractice={openingPractice}
            setupModel={() => setSettings(true)}
          />
        )
      ) : null}
    </StudyVaultScopeContext>
  );

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        const selected = tabs.find((entry) => entry === value);
        if (selected) go(selected);
      }}
      variant="underline"
      onKeyDown={(event) => {
        if (focusedReader && event.key === "Escape" && !event.defaultPrevented &&
            event.target instanceof HTMLElement && event.currentTarget.contains(event.target) &&
            !event.target.closest("input, select, textarea, [contenteditable]")) {
          event.preventDefault();
          changeReaderFocus(false);
        }
      }}
      className={cn(
        "h-full min-h-0 gap-0 overflow-hidden bg-card",
        !focusedReader && "rounded-3xl ring-1 ring-border",
      )}
    >
      <Tabs.List aria-label={t("study.sections")} className={cn("shrink-0 px-2 sm:px-4", (readingBook || (focusedReader && !unavailableBook)) && "hidden")}>
        {tabs.map((entry) => (
          <Tabs.Trigger key={entry} value={entry}>
            {t(`study.tabs.${entry}`)}
            {entry === "review" && dueNow ? (
              <Tabs.Badge>
                <span aria-hidden="true">{dueNow}</span>
                <span className="sr-only">{t("study.tabs.dueCount", { count: dueNow })}</span>
              </Tabs.Badge>
            ) : null}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {tabs.map((entry) => (
        <Tabs.Content key={entry} value={entry} className="flex min-h-0 flex-col">
          {entry === tab ? (
            readingBook ? (
              // The reader fills the card with its own bars, scrolling and side panel.
              <div className="relative flex min-h-0 flex-1">{content}</div>
            ) : (
              <div className="relative flex min-h-0 flex-1">
                <ScrollArea
                  key={`${studyVaultId}:${thread?.id ?? ""}`}
                  className="min-h-0 min-w-0 flex-1"
                >
                  <div className="mx-auto max-w-6xl px-4 pt-5 pb-8 sm:px-6">{content}</div>
                </ScrollArea>
              </div>
            )
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
