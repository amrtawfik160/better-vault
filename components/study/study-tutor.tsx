import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { StudySessionReport } from "./study-session-report";
import { StudyOriginLink } from "./study-origin-link";
import {
  TutorMaterialPicker,
  availableTutorSelection,
  emptyTutorSelection,
  tutorSelectionCount,
  type TutorMaterial,
  type TutorMaterialOptions,
  type TutorMaterialSelection,
} from "./tutor-material-picker";
import { StudyFlashcardDraftDialog, type FlashcardSource } from "./study-flashcard-generator";
import { originHref, studyHref } from "@/lib/study/links";
import { Button, buttonVariants } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import { modelKey, parseModelKey } from "@/lib/ai/catalog";
import {
  activeModel,
  availableModels,
  modelDisplayLabel,
  updateSettings,
  useSettings,
} from "@/lib/db/settings";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import type { Note } from "@/lib/db/types";
import {
  saveStudyCard,
  saveStudyWord,
  saveStudyNote,
  putStudyRecords,
  recordStudyActivity,
  readStudyThread,
  readStudyTutorSources,
  removeStudyRecord,
  studyConversationDefaults,
  studyId,
  updateStudyThread,
  updateStudyReport,
} from "@/lib/db/study";
import { askStudyModel } from "@/lib/study/client";
import { passagesFor, tutorBookOrigin } from "@/lib/study/passages";
import { matchesStudyReport, studyReportKey, studyReports } from "@/lib/study/reports";
import { Markdown } from "@/components/chat/markdown";
import { recordStudyVoice, transcribeStudyVoice } from "@/lib/study/voice";
import {
  speakStudyReply,
  startStudyVoiceSession,
  type StudyVoicePhase,
} from "@/lib/study/voice-session";
import {
  studyCorrections,
  studyGoals,
  studyScopes,
  type StudyBook,
  type StudyThread,
  type StudyThreadChange,
  type StudyRecordOf,
  type StudyReportChange,
  type StudyOrigin,
} from "@/lib/study/records";

const goalLabels = {
  book: "Book questions",
  "teach-back": "Teach it back",
  language: "Language practice",
  general: "General tutor",
};
const scopeLabels = {
  passage: "Selection",
  chapter: "Current section",
  book: "Whole book",
  notes: "Selected notes",
  general: "General",
};
const correctionLabels = { live: "During the conversation", report: "At the end", off: "Off" };
const optionClass = "rounded-lg border bg-background p-2 text-sm";
type VoiceCapture = {
  abort: AbortController;
  stop?: () => void;
  mute?: (muted: boolean) => void;
};

type LiveVoice = ReturnType<typeof startStudyVoiceSession> & { abort: AbortController };

function tutorMaterialOptions(
  scope: StudyThread["scope"],
  books: StudyBook[],
  notes: Note[],
  sources: TutorMaterial[],
  selection: TutorMaterialSelection,
): TutorMaterialOptions {
  if (scope !== "materials") return { bookIds: [], sourceIds: [], noteIds: notes };
  const bookSources = new Set(books.map(({ sourceId }) => sourceId));
  const savedSources = new Set(selection.sourceIds);
  const sourcesInUse = new Set(sources.filter(({ id }) => savedSources.has(id)).map(({ id }) => id));
  return {
    bookIds: books.filter(({ sourceId }) => !sourcesInUse.has(sourceId)),
    sourceIds: sources.filter(({ id }) => !bookSources.has(id) || savedSources.has(id)),
    noteIds: notes,
  };
}

export function TutorIndex({
  threads,
  books,
  notes,
  notebookSources,
  vaultId,
  open,
}: {
  threads: StudyThread[];
  books: StudyBook[];
  notes: Note[];
  notebookSources: TutorMaterial[];
  vaultId: string;
  open: (thread: StudyThread) => void;
}) {
  const { t } = useTranslation("home");
  const [goal, setGoal] = useState<StudyThread["goal"]>("book");
  const [scope, setScope] = useState<StudyThread["scope"]>("general");
  const [bookId, setBookId] = useState("");
  const [materialSelection, setSelection] = useState(emptyTutorSelection);
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<StudyThread | null>(null);
  const savedSettings = useSettings();
  const curated = scope === "notes" || scope === "materials";
  const readableBooks = useMemo(
    () => books.filter(({ sections }) => sections.some(({ text }) => text.trim())),
    [books],
  );
  const readableNotes = useMemo(() => notes.filter(({ body }) => body.trim()), [notes]);
  const selection =
    scope === "materials"
      ? materialSelection
      : { ...emptyTutorSelection, noteIds: materialSelection.noteIds };
  const materialOptions = tutorMaterialOptions(
    scope,
    readableBooks,
    readableNotes,
    notebookSources,
    selection,
  );
  const selected = availableTutorSelection(materialOptions, selection);
  const selectedCount = tutorSelectionCount(selected);
  const ready = !curated || selectedCount > 0;

  return (
    <section className="space-y-5">
      <h2 className="text-xl font-semibold">Study tutor</h2>
      <form
        className="grid gap-3 rounded-2xl border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          const book =
            scope === "book" || scope === "chapter"
              ? books.find((item) => item.id === bookId)
              : undefined;
          const materialTitle = curated
            ? (readableBooks.find(({ id }) => id === selected.bookIds[0])?.title ??
              notebookSources.find(({ id }) => id === selected.sourceIds[0])?.title ??
              readableNotes.find(({ id }) => id === selected.noteIds[0])?.title)
            : undefined;
          const subject =
            materialTitle && selectedCount > 1
              ? t("study.materials.threadTitle", { title: materialTitle, count: selectedCount - 1 })
              : (materialTitle ?? book?.title);
          const thread: StudyThread = {
            id: studyId(),
            kind: "thread",
            title: subject ? `${goalLabels[goal]} · ${subject}` : goalLabels[goal],
            goal,
            scope,
            messages: [],
            vaultId,
            bookId: book?.id,
            ...(curated ? selected : {}),
            notebookId: scope === "book" || scope === "chapter" ? book?.notebookId : undefined,
            updatedAt: Date.now(),
          };
          void studyConversationDefaults(goal)
            .then((defaults) => putStudyRecords({ ...thread, ...defaults }))
            .then(() => open(thread))
            .catch((error: Error) => toast.error(error.message));
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">
            Goal
            <select
              className={optionClass}
              value={goal}
              onChange={(event) => setGoal(event.target.value as StudyThread["goal"])}
            >
              {studyGoals.map((value) => (
                <option key={value} value={value}>
                  {goalLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            {t("study.materials.context")}
            <select
              aria-label={t("study.materials.context")}
              className={optionClass}
              value={scope}
              onChange={(event) => setScope(event.target.value as StudyThread["scope"])}
            >
              {studyScopes
                .filter((value) => value !== "passage")
                .map((value) => (
                  <option key={value} value={value}>
                    {value === "materials" ? t("study.materials.scope") : scopeLabels[value]}
                  </option>
                ))}
            </select>
          </label>
          {scope === "chapter" || scope === "book" ? (
            <label className="grid gap-1 text-sm">
              Document
              <select
                className={optionClass}
                value={bookId}
                required
                onChange={(event) => setBookId(event.target.value)}
              >
                <option value="">Choose a document</option>
                {books.map((book) => (
                  <option value={book.id} key={book.id}>
                    {book.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {curated ? (
            <TutorMaterialPicker
              options={materialOptions}
              selection={selection}
              onApply={(change) =>
                setSelection((current) =>
                  scope === "materials" ? change : { ...current, noteIds: change.noteIds },
                )
              }
            />
          ) : null}
          <Button type="submit" disabled={!ready}>
            Start conversation
          </Button>
        </div>
      </form>
      <details className="rounded-xl border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Tutor preferences</summary>
        <div className="mt-3 grid gap-3">
          <label className="flex flex-wrap items-center gap-2">
            Default corrections
            <select
              className={optionClass}
              value={savedSettings?.study?.corrections ?? ""}
              onChange={(event) => {
                const corrections = studyCorrections.find((value) => value === event.target.value);
                void updateSettings((saved) => {
                  saved.study = { ...saved.study, corrections };
                });
              }}
            >
              <option value="">Based on the goal</option>
              {studyCorrections.map((value) => (
                <option key={value} value={value}>
                  {correctionLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={savedSettings?.study?.keepVoiceTranscripts ?? false}
              onChange={(event) => {
                const keepVoiceTranscripts = event.target.checked;
                void updateSettings((saved) => {
                  saved.study = { ...saved.study, keepVoiceTranscripts };
                });
              }}
            />
            Keep voice transcripts in new conversations
          </label>
        </div>
      </details>
      {threads.length > 0 ? (
        <Input
          type="search"
          aria-label="Search conversations"
          placeholder="Search conversations"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}
      <ul className="divide-y rounded-2xl border">
        {threads
          .filter((thread) => thread.title.toLowerCase().includes(query.toLowerCase()))
          .map((thread) => (
            <li className="flex flex-wrap items-center justify-between gap-2 p-4" key={thread.id}>
              <button
                type="button"
                className="min-w-0 cursor-pointer text-start font-medium wrap-break-word hover:underline"
                onClick={() => open(thread)}
              >
                {thread.title}
              </button>
              {thread.report ? (
                <StudyOriginLink
                  origin={{
                    kind: "report",
                    threadId: thread.id,
                    reportId: studyReportKey(thread.report),
                  }}
                />
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setDeleting(thread)}>
                Delete
              </Button>
            </li>
          ))}
      </ul>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete conversation?"
        body={t("study.followUps.deleteConversationBody")}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleting) await removeStudyRecord(deleting.id);
          setDeleting(null);
        }}
      />
    </section>
  );
}

export function StudyTutor({
  thread,
  vaultId,
  vaultNotes,
  vaultBooks,
  notebookSources,
  book,
  openReport,
  requestedReportId,
  reportCards,
  focusMessage,
  back,
  setup,
}: {
  thread: StudyThread;
  vaultId: string;
  vaultNotes: Note[];
  vaultBooks: StudyBook[];
  notebookSources: TutorMaterial[];
  book?: StudyBook;
  openReport?: boolean;
  requestedReportId?: string;
  reportCards: StudyRecordOf<"card">[];
  focusMessage?: number;
  back: () => void;
  setup: () => void;
}) {
  const { t, i18n } = useTranslation("home");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const [showReport, setShowReport] = useState(openReport ?? false);
  const [selectedReportId, setSelectedReportId] = useState(requestedReportId);
  const navigate = useNavigate();
  const [voiceState, setVoiceState] = useState<"opening" | "recording" | "transcribing" | null>(
    null,
  );
  const [voicePractice, setVoicePractice] = useState(false);
  const [livePhase, setLivePhase] = useState<StudyVoicePhase | null>(null);
  const [draftSource, setDraftSource] = useState<FlashcardSource | null>(null);
  const [temporaryTurns, setTemporaryTurns] = useState<StudyThread["messages"]>([]);
  const recentTurns = useRef<StudyThread["messages"]>([]);
  const [micMuted, setMicMuted] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState<boolean>();
  const [readAloud, setReadAloud] = useState(false);
  const [language, setLanguage] = useState(thread.practiceLanguage ?? "");
  const workPending = busy || voiceState !== null || livePhase !== null;
  const curated = thread.scope === "materials" || thread.scope === "notes";
  const readableBooks = useMemo(
    () =>
      thread.scope === "materials"
        ? vaultBooks.filter(({ sections }) => sections.some(({ text }) => text.trim()))
        : [],
    [thread.scope, vaultBooks],
  );
  const readableNotes = useMemo(() => vaultNotes.filter(({ body }) => body.trim()), [vaultNotes]);
  const selection = {
    bookIds: thread.scope === "materials" ? (thread.bookIds ?? []) : [],
    sourceIds: thread.scope === "materials" ? (thread.sourceIds ?? []) : [],
    noteIds: thread.noteIds ?? [],
  };
  const materialOptions = tutorMaterialOptions(
    thread.scope,
    readableBooks,
    readableNotes,
    notebookSources,
    selection,
  );
  const selected = availableTutorSelection(materialOptions, selection);
  const contextReady = !curated || tutorSelectionCount(selected) > 0;
  const controller = useRef<AbortController | null>(null);
  const voice = useRef<VoiceCapture | null>(null);
  const live = useRef<LiveVoice | null>(null);
  const settings = useSettings();
  const model = settings ? activeModel(settings) : null;
  const models = settings ? availableModels(settings) : [];
  const reports = studyReports(thread);
  const visibleReport = selectedReportId
    ? reports.find((entry) => studyReportKey(entry) === selectedReportId)
    : openReport
      ? (reports.find((entry) => !entry.id) ?? reports[0])
      : reports[0];
  const reportId = visibleReport ? studyReportKey(visibleReport) : undefined;
  const reportCardCount = reportId
    ? reportCards.filter((card) => matchesStudyReport(card.origin, thread.id, reportId)).length
    : 0;
  const reportDate = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
  const conversation = [
    ...thread.messages.map((entry, index) => ({ entry, index })),
    ...temporaryTurns.map((entry) => ({ entry, index: undefined })),
  ].sort((a, b) => (a.entry.at ?? 0) - (b.entry.at ?? 0));

  useEffect(() => {
    const probe = new AbortController();
    window.speechSynthesis?.getVoices();
    void fetch("/api/study/voice", { signal: probe.signal })
      .then((response) => response.json())
      .then((status) => setVoiceAvailable(status.available === true))
      .catch(() => {
        if (!probe.signal.aborted) setVoiceAvailable(false);
      });
    const leave = () => {
      if (document.hidden) live.current?.abort.abort();
    };
    document.addEventListener("visibilitychange", leave);
    return () => {
      document.removeEventListener("visibilitychange", leave);
      probe.abort();
      controller.current?.abort();
      voice.current?.abort.abort();
      live.current?.abort.abort();
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    if (focusMessage !== undefined)
      document.getElementById(`study-message-${focusMessage}`)?.scrollIntoView({ block: "center" });
    if (showReport)
      document.getElementById("study-session-report")?.scrollIntoView({ block: "start" });
  }, [focusMessage, reportId, showReport]);

  async function save(change: StudyThreadChange) {
    await updateStudyThread(thread.id, change);
  }

  function saveTemporaryTurns(turns: StudyThread["messages"]) {
    recentTurns.current = turns;
    setTemporaryTurns(turns);
  }

  async function currentConversation(): Promise<StudyThread> {
    const latest = await readStudyThread(thread.id);
    return {
      ...latest,
      practiceLanguage: language.trim() || undefined,
      messages: [...latest.messages, ...recentTurns.current].sort(
        (a, b) => (a.at ?? 0) - (b.at ?? 0),
      ),
    };
  }

  async function send(
    message: string,
    submittedAt: number,
    { spoken = false, session }: { spoken?: boolean; session?: AbortSignal } = {},
  ) {
    const text = message.trim();
    if (!text || controller.current || !model) return;
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    const signal = session ? AbortSignal.any([abort.signal, session]) : abort.signal;
    try {
      const current = await currentConversation();
      const sources = await readStudyTutorSources(current, vaultId);
      signal.throwIfAborted();
      const passages = passagesFor(current, sources, text);
      if (current.scope !== "general" && !passages.length)
        throw new Error(
          current.scope === "materials"
            ? t("study.materials.noReadableSelection")
            : current.scope === "notes"
              ? "Choose a note with text first."
              : "This scope has no readable text. Choose another context.",
        );
      const answer = await askStudyModel({
        action: "chat",
        input: text,
        passages,
        thread: current,
        signal,
        spoken,
      });
      signal.throwIfAborted();
      const citations = [...new Set(answer.citations ?? [])].flatMap((index) => {
        const passage = passages[index - 1];
        return passage ? [{ index, origin: passage.origin, title: passage.title }] : [];
      });
      const turns: StudyThread["messages"] = [
        { role: "user", text, at: submittedAt },
        { role: "assistant", text: answer.text, citations, at: submittedAt },
      ];
      if (spoken && !current.keepVoiceTranscripts)
        saveTemporaryTurns([...recentTurns.current, ...turns]);
      else
        await updateStudyThread(thread.id, { practiceLanguage: current.practiceLanguage }, turns);
      if (spoken) setVoicePractice(true);
      if (!session) {
        setInput("");
        if (spoken || readAloud)
          void speakStudyReply(answer.text, language.trim()).then((played) => {
            if (!played) toast.info(t("study.voice.speechUnavailable"));
          });
      }
      return answer.text;
    } catch (error) {
      if (session) throw error;
      if (!signal.aborted) toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      controller.current = null;
      setBusy(false);
    }
  }

  async function checkVoice(signal: AbortSignal) {
    const response = await fetch("/api/study/voice", { signal });
    const status: { available?: boolean } = await response.json();
    setVoiceAvailable(status.available === true);
    if (!status.available) throw new Error(t("study.voice.localUnavailable"));
  }

  async function dictate(sendTurn: boolean, startedAt: number) {
    if (voice.current || live.current || controller.current) return;
    const capture: VoiceCapture = { abort: new AbortController() };
    voice.current = capture;
    const signal = capture.abort.signal;
    setVoiceState("opening");
    window.speechSynthesis?.cancel();
    try {
      await checkVoice(signal);
      const recording = await recordStudyVoice(signal);
      capture.stop = recording.stop;
      capture.mute = recording.mute;
      setVoiceState("recording");
      const turn = await recording.result;
      signal.throwIfAborted();
      if (!turn) return;
      const { audio, seconds } = turn;
      setVoiceState("transcribing");
      const transcript = await transcribeStudyVoice(audio, language, signal);
      signal.throwIfAborted();
      const activity = recordStudyActivity("speaking", seconds, thread.notebookId, {
        kind: "tutor",
        threadId: thread.id,
      });
      if (sendTurn) {
        setInput(transcript);
        await Promise.all([
          activity,
          send(transcript, startedAt + Math.round(seconds * 1000), { spoken: true }),
        ]);
      } else {
        setInput((value) => (value ? `${value} ${transcript}` : transcript));
        await activity;
      }
    } catch (error) {
      if (!signal.aborted) toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      voice.current = null;
      setVoiceState(null);
      setMicMuted(false);
    }
  }

  async function beginVoiceConversation() {
    if (voice.current || live.current || controller.current || !model || !contextReady) return;
    const abort = new AbortController();
    const { signal } = abort;
    setLivePhase("opening");
    window.speechSynthesis?.cancel();
    const session = startStudyVoiceSession({
      language: language.trim(),
      signal,
      ready: () => checkVoice(signal),
      phase: setLivePhase,
      speechUnavailable: () => toast.info(t("study.voice.speechUnavailable")),
      respond: async (transcript, seconds) => {
        try {
          const activity = recordStudyActivity("speaking", seconds, thread.notebookId, {
            kind: "tutor",
            threadId: thread.id,
          }).catch((error: Error) => toast.error(error.message));
          const reply = await send(transcript, Date.now(), { spoken: true, session: signal });
          await activity;
          if (!reply) throw new Error(t("study.voice.replyUnavailable"));
          return reply;
        } catch (error) {
          if (!signal.aborted)
            setInput((draft) => (draft ? `${draft}\n${transcript}` : transcript));
          throw error;
        }
      },
    });
    live.current = { ...session, abort };
    try {
      if ((await session.result) === "idle") toast.info(t("study.voice.idle"));
    } catch (error) {
      if (!signal.aborted) {
        const failure = error instanceof DOMException ? error.name : undefined;
        let message = error instanceof Error ? error.message : String(error);
        if (failure === "NotAllowedError") message = t("study.voice.permission");
        if (failure === "NotFoundError" || failure === "NotReadableError")
          message = t("study.voice.microphoneUnavailable");
        toast.error(message);
      }
    } finally {
      live.current = null;
      setLivePhase(null);
      setMicMuted(false);
    }
  }

  async function report(generatedAt: number) {
    if (controller.current) return;
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const context = await currentConversation();
      const sources = await readStudyTutorSources(context, vaultId);
      abort.signal.throwIfAborted();
      const history = context.messages;
      const topic = history
        .filter(({ role }) => role === "user")
        .slice(-3)
        .map(({ text }) => text)
        .join(" ");
      const result = await askStudyModel({
        action: "report",
        input: "Write a report on the study conversation.",
        passages: passagesFor(context, sources, topic),
        thread: context,
        signal: abort.signal,
      });
      if (!abort.signal.aborted && result.report) {
        const requested = context.corrections && context.corrections !== "off";
        const hasLanguageEvidence = history.some(
          (entry) => entry.role === "user" && entry.text.trim().split(/\s+/).length >= 5,
        );
        const languageStatus = requested
          ? hasLanguageEvidence
            ? "reviewed"
            : "insufficient"
          : "not-requested";
        const reportId = studyId();
        const saved = await updateStudyReport(thread.id, {
          kind: "save",
          practiceLanguage: context.practiceLanguage ?? null,
          report: {
            ...result.report,
            id: reportId,
            generatedAt,
            languageStatus,
            languageFeedback: languageStatus === "reviewed" ? result.report.languageFeedback : [],
            vocabulary: languageStatus === "reviewed" ? result.report.vocabulary : [],
          },
        });
        if (!saved) throw new Error(t("study.followUps.unavailable"));
        setSelectedReportId(reportId);
        setShowReport(true);
        setVoicePractice(false);
        saveTemporaryTurns([]);
      }
    } catch (error) {
      if (!abort.signal.aborted)
        toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      controller.current = null;
      setBusy(false);
    }
  }

  async function finishVoiceReport() {
    const session = live.current;
    if (session) {
      session.abort.abort();
      await session.result.catch(() => undefined);
    }
    await report(Date.now());
  }

  function saveNote(text: string, origin: StudyOrigin) {
    void saveStudyNote({
      notebookId: thread.notebookId,
      vaultId,
      title: thread.title,
      body: text,
      origin,
    })
      .then((note) =>
        toast.success("Saved to Notes", {
          action: {
            label: "Open note",
            onClick: () => navigate(originHref({ kind: "note", noteId: note.id })),
          },
        }),
      )
      .catch((error: Error) => toast.error(error.message));
  }

  function draftCards(text: string, origin: StudyOrigin) {
    setDraftSource({
      title: thread.title,
      text,
      origin,
      notebookId: thread.notebookId,
      tags: book ? [book.title] : [],
    });
  }

  function changeReport(change: StudyReportChange) {
    void updateStudyReport(thread.id, change)
      .then((saved) => {
        if (!saved) toast.error(t("study.followUps.unavailable"));
      })
      .catch((error: Error) => toast.error(error.message));
  }

  function makeCard(front: string, back: string, origin: StudyOrigin, id: string) {
    void saveStudyCard(
      { front, back, tags: [thread.title], notebookId: thread.notebookId, origin },
      id,
    )
      .then((card) =>
        toast.success("Flashcard saved", {
          action: {
            label: "View flashcard",
            onClick: () => navigate(studyHref("cards", { card: card.id })),
          },
        }),
      )
      .catch((error: Error) => toast.error(error.message));
  }

  return (
    <section className="max-w-4xl space-y-4">
      <Button variant="ghost" size="sm" onClick={back}>
        ← Conversations
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {renaming ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (title.trim())
                void save({ title: title.trim() })
                  .then(() => setRenaming(false))
                  .catch((error: Error) => toast.error(error.message));
            }}
          >
            <Input
              aria-label="Conversation title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <Button type="submit" size="sm">
              Save
            </Button>
          </form>
        ) : (
          <h2 className="text-xl font-semibold" dir="auto">
            {thread.title}
          </h2>
        )}
        <div className="flex flex-wrap gap-2">
          {book && <StudyOriginLink origin={tutorBookOrigin(thread, book)} />}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRenaming(!renaming)}>
            Rename
          </Button>
          <Button variant="outline" size="sm" onClick={setup} disabled={workPending}>
            AI providers
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 rounded-xl border p-3 text-sm">
        <label className="grid gap-1">
          AI model
          <select
            aria-label="AI model"
            className={optionClass}
            disabled={workPending || !models.length}
            value={model ? modelKey(model) : ""}
            onChange={(event) => {
              const chosen = parseModelKey(event.target.value);
              if (chosen)
                void updateSettings((saved) => {
                  saved.model = chosen;
                });
            }}
          >
            {model ? null : <option value="">Choose a model</option>}
            {models.map((option) => (
              <option key={modelKey(option)} value={modelKey(option)}>
                {modelDisplayLabel(settings, option)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          {t("study.materials.context")}
          <select
            aria-label={t("study.materials.context")}
            className={optionClass}
            disabled={workPending}
            value={thread.scope}
            onChange={(event) => {
              const scope = studyScopes.find((value) => value === event.target.value);
              if (scope)
                void save({
                  scope,
                  ...(scope === "materials" && thread.bookIds === undefined && book
                    ? { bookIds: [book.id] }
                    : {}),
                });
            }}
          >
            {studyScopes
              .filter(
                (scope) =>
                  scope === "general" ||
                  scope === "notes" ||
                  scope === "materials" ||
                  (book && (scope !== "passage" || thread.quote)),
              )
              .map((scope) => (
                <option value={scope} key={scope}>
                  {scope === "materials" ? t("study.materials.scope") : scopeLabels[scope]}
                </option>
              ))}
          </select>
        </label>
        <label className="grid gap-1">
          Corrections
          <select
            aria-label="Corrections"
            className={optionClass}
            disabled={workPending}
            value={thread.corrections ?? "off"}
            onChange={(event) =>
              void save({ corrections: event.target.value as StudyThread["corrections"] })
            }
          >
            {studyCorrections.map((value) => (
              <option value={value} key={value}>
                {correctionLabels[value]}
              </option>
            ))}
          </select>
        </label>
        {curated ? (
          <div className="flex basis-full flex-wrap items-center gap-2">
            <TutorMaterialPicker
              options={materialOptions}
              selection={selection}
              disabled={workPending}
              onApply={(next) =>
                save(thread.scope === "materials" ? next : { noteIds: next.noteIds })
              }
            />
            {!contextReady ? (
              <p className="text-muted-foreground">{t("study.materials.noReadableSelection")}</p>
            ) : null}
          </div>
        ) : null}
      </div>
      {conversation.length ? (
        <div className="space-y-3" aria-label="Conversation">
          {conversation.map(({ entry, index }) => (
            <div
              key={index === undefined ? `temporary-${entry.at}-${entry.role}` : index}
              id={index === undefined ? undefined : `study-message-${index}`}
              className={`max-w-3xl scroll-mt-32 space-y-2 rounded-2xl border p-4 ${entry.role === "user" ? "ms-auto w-fit bg-muted" : "bg-card"}`}
            >
              <p className="text-xs font-semibold text-muted-foreground">
                {entry.role === "user" ? "You" : "Tutor"}
              </p>
              {entry.role === "assistant" ? (
                <Markdown text={entry.text} />
              ) : (
                <p dir="auto" className="wrap-break-word whitespace-pre-wrap">
                  {entry.text}
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {entry.citations?.map((citation) => (
                  <StudyOriginLink
                    key={citation.index}
                    origin={
                      "origin" in citation
                        ? citation.origin
                        : { kind: "book", bookId: citation.bookId, section: citation.section }
                    }
                    label={`[${citation.index}] ${citation.title}`}
                  />
                ))}
                {entry.role === "assistant" ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        saveNote(entry.text, { kind: "tutor", threadId: thread.id, message: index })
                      }
                    >
                      Save to Notes
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        draftCards(entry.text, {
                          kind: "tutor",
                          threadId: thread.id,
                          message: index,
                        })
                      }
                    >
                      {t("study.capture.cardsFromAnswer")}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {thread.goal === "teach-back" ? (
            <Button
              disabled={workPending || !model}
              onClick={() => void send(t("study.capture.practicePrompt"), Date.now())}
            >
              {t("study.capture.startPractice")}
            </Button>
          ) : null}
          {(thread.goal === "teach-back"
            ? ["Ask me to explain the main idea.", "Quiz me on the hardest part."]
            : thread.goal === "language"
              ? ["Help me practice a conversation.", "Correct my phrasing."]
              : ["Explain the main idea.", "Give me a practice question."]
          ).map((prompt) => (
            <Button
              variant="outline"
              size="sm"
              key={prompt}
              disabled={workPending}
              onClick={() => setInput(prompt)}
            >
              {prompt}
            </Button>
          ))}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(input, Date.now());
        }}
        className="grid gap-2 rounded-2xl border bg-card p-3"
      >
        <textarea
          className="min-h-24 w-full rounded-xl border bg-background p-3"
          aria-label="Study message"
          placeholder="Ask a question or explain what you learned"
          dir="auto"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          maxLength={12000}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!input.trim() || workPending || !model || !contextReady}>
            {busy ? "Working…" : "Send"}
          </Button>
          {busy && !livePhase ? (
            <Button type="button" variant="ghost" onClick={() => controller.current?.abort()}>
              Stop
            </Button>
          ) : null}
          {voiceState === "recording" ? (
            <>
              <Button type="button" variant="outline" onClick={() => voice.current?.stop?.()}>
                Stop recording
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-pressed={micMuted}
                onClick={() => {
                  voice.current?.mute?.(!micMuted);
                  setMicMuted(!micMuted);
                }}
              >
                {micMuted ? "Unmute microphone" : "Mute microphone"}
              </Button>
            </>
          ) : null}
          {voiceState && !busy ? (
            <Button type="button" variant="ghost" onClick={() => voice.current?.abort.abort()}>
              Cancel recording
            </Button>
          ) : null}
          {!voiceState && !livePhase ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => void dictate(false, Date.now())}
                disabled={busy}
              >
                Dictate
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void dictate(true, Date.now())}
                disabled={busy || !model || !contextReady}
              >
                {voicePractice ? "Record next turn" : "Speak to tutor"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void beginVoiceConversation()}
                disabled={busy || !model || !contextReady}
              >
                {t("study.voice.start")}
              </Button>
            </>
          ) : null}
          {livePhase ? (
            <>
              {livePhase === "recording" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={micMuted}
                  onClick={() => live.current?.finishTurn()}
                >
                  {t("study.voice.sendTurn")}
                </Button>
              ) : null}
              {livePhase === "speaking" ? (
                <Button type="button" variant="outline" onClick={() => live.current?.interrupt()}>
                  {t("study.voice.interrupt")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                aria-pressed={micMuted}
                onClick={() => {
                  live.current?.mute(!micMuted);
                  setMicMuted(!micMuted);
                }}
              >
                {t(micMuted ? "study.voice.unmute" : "study.voice.mute")}
              </Button>
              <Button type="button" variant="outline" onClick={() => live.current?.abort.abort()}>
                {t("study.voice.end")}
              </Button>
            </>
          ) : null}
          <Input
            className="w-32"
            aria-label="Speech language code"
            placeholder="Auto language"
            value={language}
            maxLength={35}
            disabled={workPending}
            onChange={(event) => setLanguage(event.target.value)}
          />
          {!livePhase ? (
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={readAloud}
                onChange={(event) => {
                  setReadAloud(event.target.checked);
                  if (!event.target.checked) window.speechSynthesis?.cancel();
                }}
              />
              Read replies aloud
            </label>
          ) : null}
        </div>
        {settings && !model ? (
          <p className="text-sm text-muted-foreground">{t("study.capture.chooseModel")}</p>
        ) : null}
        {voiceAvailable ? (
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={thread.keepVoiceTranscripts ?? false}
              disabled={workPending}
              onChange={(event) => void save({ keepVoiceTranscripts: event.target.checked })}
            />
            Keep new voice turns in this conversation
          </label>
        ) : null}
        {temporaryTurns.length ? (
          <p className="text-sm text-muted-foreground">
            Temporary voice turns clear after the report or when you leave this conversation.
          </p>
        ) : null}
        {livePhase ? (
          <div className="space-y-1 text-sm text-muted-foreground">
            <p role="status">
              {t(
                micMuted && (livePhase === "listening" || livePhase === "recording")
                  ? "study.voice.muted"
                  : `study.voice.phases.${livePhase}`,
              )}
            </p>
            <p>{t("study.voice.privacy")}</p>
          </div>
        ) : voiceState ? (
          <p role="status" className="text-sm text-muted-foreground">
            {voiceState === "opening"
              ? "Opening microphone…"
              : voiceState === "recording"
                ? micMuted
                  ? "Microphone muted"
                  : "Recording on this device"
                : "Transcribing on this device…"}
          </p>
        ) : voiceAvailable === false ? (
          <p className="text-sm text-muted-foreground">
            Local voice needs whisper-cli and a Whisper model. You can still type a message.
          </p>
        ) : null}
      </form>
      {conversation.length || reports.length || showReport ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {reports.length ? (
              <Button
                variant="outline"
                onClick={() => {
                  if (!showReport) setSelectedReportId(studyReportKey(reports[0]));
                  setShowReport(!showReport);
                }}
              >
                {showReport ? "Hide report" : "Show report"}
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={(!livePhase && workPending) || !model || !conversation.length}
              onClick={() => void finishVoiceReport()}
            >
              {livePhase
                ? t("study.voice.endAndReport")
                : voicePractice
                  ? "Finish voice practice and generate report"
                  : reports.length
                    ? "Regenerate report"
                    : "Generate session report"}
            </Button>
          </div>
          {showReport && reports.length > 1 ? (
            <label className="flex flex-wrap items-center gap-2 text-sm">
              {t("study.followUps.reportHistory")}
              <select
                className={optionClass}
                value={reportId ?? ""}
                onChange={(event) => setSelectedReportId(event.target.value)}
              >
                {reportId ? null : (
                  <option value="" disabled>
                    {t("study.followUps.unavailable")}
                  </option>
                )}
                {reports.map((entry, index) => (
                  <option value={studyReportKey(entry)} key={studyReportKey(entry)}>
                    {index === 0
                      ? t("study.followUps.latest")
                      : entry.generatedAt === undefined
                        ? t("study.followUps.earlier")
                        : reportDate.format(entry.generatedAt)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {showReport && !visibleReport ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t("study.followUps.unavailable")}
            </p>
          ) : null}
          {showReport && visibleReport && reportId ? (
            <StudySessionReport
              report={visibleReport}
              actions={
                reportCardCount ? (
                  <div className="flex flex-wrap gap-2">
                    <Link
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                      to={studyHref("cards", { thread: thread.id, fromReport: reportId })}
                    >
                      {t("study.followUps.viewCards", { count: reportCardCount })}
                    </Link>
                    <Link
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                      to={studyHref("review", { thread: thread.id, fromReport: reportId })}
                    >
                      {t("study.followUps.reviewCards")}
                    </Link>
                  </div>
                ) : null
              }
              onDraftCard={(text) =>
                draftCards(text, { kind: "report", threadId: thread.id, reportId })
              }
              onFeedback={(key, helpful) =>
                changeReport({ kind: "feedback", reportId, key, helpful })
              }
              onPlanStep={(index, action) =>
                changeReport({ kind: "step", reportId, index, action })
              }
              onSaveCard={(front, back, key) =>
                makeCard(
                  front,
                  back,
                  { kind: "report", threadId: thread.id, reportId },
                  `report-card-${thread.id}-${visibleReport.id ?? visibleReport.generatedAt ?? 0}-${key}`,
                )
              }
              onSaveWord={(word, key) => {
                void saveStudyWord(
                  {
                    term: word.term,
                    language: word.language,
                    translation: word.translation,
                    context: word.example,
                    note: word.definition,
                    notebookId: thread.notebookId,
                    origin: { kind: "report", threadId: thread.id, reportId },
                  },
                  `report-word-${thread.id}-${visibleReport.id ?? visibleReport.generatedAt ?? 0}-${key}`,
                )
                  .then((saved) =>
                    toast.success("Saved to vocabulary", {
                      action: {
                        label: "View word",
                        onClick: () => navigate(originHref({ kind: "word", wordId: saved.id })),
                      },
                    }),
                  )
                  .catch((error: Error) => toast.error(error.message));
              }}
              onSaveNote={() => {
                const report = visibleReport;
                saveNote(
                  [
                    report.summary,
                    ...report.corrections,
                    ...(report.technicalFeedback ?? []).map(({ text }) => text),
                    ...(report.languageFeedback ?? []).map(
                      ({ original, suggestion, reason }) =>
                        `${original} → ${suggestion}. ${reason}`,
                    ),
                    ...(report.vocabulary ?? []).map(({ term, definition, translation }) =>
                      [term, definition, translation].filter(Boolean).join(" · "),
                    ),
                    ...report.nextSteps,
                  ]
                    .filter(Boolean)
                    .join("\n\n"),
                  { kind: "report", threadId: thread.id, reportId },
                );
              }}
            />
          ) : null}
        </div>
      ) : null}
      {draftSource ? (
        <StudyFlashcardDraftDialog
          source={draftSource}
          onClose={() => setDraftSource(null)}
          onSave={(count) =>
            toast.success(t("study.capture.cardsSaved", { count }), {
              action: {
                label: t("study.capture.viewCards"),
                onClick: () =>
                  navigate(
                    studyHref(
                      "cards",
                      draftSource.origin.kind === "report"
                        ? { thread: thread.id, fromReport: draftSource.origin.reportId ?? "legacy" }
                        : thread.notebookId
                          ? { notebook: thread.notebookId }
                          : {},
                    ),
                  ),
              },
            })
          }
        />
      ) : null}
    </section>
  );
}
