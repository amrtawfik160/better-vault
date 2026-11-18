import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { StudySessionReport } from "./study-session-report";
import { StudyOriginLink } from "./study-origin-link";
import { StudyFlashcardDraftDialog, type FlashcardSource } from "./study-flashcard-generator";
import { originHref, studyHref } from "@/lib/study/links";
import { Button } from "@/components/panelui/button";
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
import { useNotes } from "@/lib/db/notes";
import {
  saveStudyCard,
  saveStudyWord,
  saveStudyNote,
  putStudyRecords,
  recordStudyActivity,
  removeStudyRecord,
  studyConversationDefaults,
  studyId,
  updateStudyThread,
} from "@/lib/db/study";
import { currentVaultId } from "@/lib/db/vaults";
import { askStudyModel } from "@/lib/study/client";
import { passagesFor } from "@/lib/study/passages";
import { Markdown } from "@/components/chat/markdown";
import { recordStudyVoice, transcribeStudyVoice } from "@/lib/study/voice";
import {
  studyCorrections,
  studyGoals,
  studyScopes,
  type StudyBook,
  type StudyThread,
  type StudyThreadChange,
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

export function TutorIndex({
  threads,
  books,
  open,
}: {
  threads: StudyThread[];
  books: StudyBook[];
  open: (thread: StudyThread) => void;
}) {
  const [goal, setGoal] = useState<StudyThread["goal"]>("book");
  const [scope, setScope] = useState<StudyThread["scope"]>("general");
  const [bookId, setBookId] = useState("");
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<StudyThread | null>(null);
  const savedSettings = useSettings();

  return (
    <section className="space-y-5">
      <h2 className="text-xl font-semibold">Study tutor</h2>
      <form
        className="grid gap-3 rounded-2xl border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const book = books.find((item) => item.id === bookId);
          const thread: StudyThread = {
            id: studyId(),
            kind: "thread",
            title: book ? `${goalLabels[goal]} · ${book.title}` : goalLabels[goal],
            goal,
            scope,
            messages: [],
            vaultId: currentVaultId(),
            bookId: book?.id,
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
            Context
            <select
              className={optionClass}
              value={scope}
              onChange={(event) => setScope(event.target.value as StudyThread["scope"])}
            >
              {studyScopes
                .filter((value) => value !== "passage")
                .map((value) => (
                  <option key={value} value={value}>
                    {scopeLabels[value]}
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
          <Button type="submit">Start conversation</Button>
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
                <StudyOriginLink origin={{ kind: "report", threadId: thread.id }} />
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
        body="The conversation and its session report will be removed."
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
  book,
  openReport,
  focusMessage,
  back,
  setup,
}: {
  thread: StudyThread;
  book?: StudyBook;
  openReport?: boolean;
  focusMessage?: number;
  back: () => void;
  setup: () => void;
}) {
  const { t } = useTranslation("home");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const [showReport, setShowReport] = useState(openReport ?? false);
  const navigate = useNavigate();
  const [voiceState, setVoiceState] = useState<"opening" | "recording" | "transcribing" | null>(
    null,
  );
  const [voicePractice, setVoicePractice] = useState(false);
  const [draftSource, setDraftSource] = useState<FlashcardSource | null>(null);
  const [temporaryTurns, setTemporaryTurns] = useState<StudyThread["messages"]>([]);
  const [micMuted, setMicMuted] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState<boolean>();
  const [readAloud, setReadAloud] = useState(false);
  const [language, setLanguage] = useState(thread.practiceLanguage ?? "");
  const workPending = busy || voiceState !== null;
  const controller = useRef<AbortController | null>(null);
  const voice = useRef<VoiceCapture | null>(null);
  const notes = useNotes();
  const settings = useSettings();
  const model = settings ? activeModel(settings) : null;
  const models = settings ? availableModels(settings) : [];
  const vaultId = thread.vaultId ?? currentVaultId();
  const vaultNotes = (notes ?? []).filter((note) => note.vaultId === vaultId);
  const conversation = [
    ...thread.messages.map((entry, index) => ({ entry, index })),
    ...temporaryTurns.map((entry) => ({ entry, index: undefined })),
  ].sort((a, b) => (a.entry.at ?? 0) - (b.entry.at ?? 0));

  useEffect(() => {
    const probe = new AbortController();
    void fetch("/api/study/voice", { signal: probe.signal })
      .then((response) => response.json())
      .then((status) => setVoiceAvailable(status.available === true))
      .catch(() => {
        if (!probe.signal.aborted) setVoiceAvailable(false);
      });
    return () => {
      probe.abort();
      controller.current?.abort();
      voice.current?.abort.abort();
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    if (focusMessage !== undefined)
      document.getElementById(`study-message-${focusMessage}`)?.scrollIntoView({ block: "center" });
    if (openReport)
      document.getElementById("study-session-report")?.scrollIntoView({ block: "start" });
  }, [focusMessage, openReport, showReport]);

  async function save(change: StudyThreadChange) {
    await updateStudyThread(thread.id, change);
  }

  async function send(message: string, submittedAt: number, spoken = false) {
    const text = message.trim();
    if (!text || controller.current || !model) return;
    const history = conversation.map(({ entry }) => entry);
    const passages = passagesFor({ ...thread, messages: history }, book, text, vaultNotes);
    if (thread.scope !== "general" && !passages.length) {
      toast.error(
        thread.scope === "notes"
          ? "Choose a note with text first."
          : "This scope has no readable text. Choose another context.",
      );
      return;
    }
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    const practiceLanguage = language.trim() || undefined;
    try {
      const answer = await askStudyModel({
        action: "chat",
        input: text,
        passages,
        thread: { ...thread, practiceLanguage, messages: history },
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      const citations = [...new Set(answer.citations ?? [])].flatMap((index) => {
        const passage = passages[index - 1];
        return passage ? [{ index, origin: passage.origin, title: passage.title }] : [];
      });
      const turns: StudyThread["messages"] = [
        { role: "user", text, at: submittedAt },
        { role: "assistant", text: answer.text, citations, at: submittedAt },
      ];
      if (spoken && !thread.keepVoiceTranscripts)
        setTemporaryTurns((value) => [...value, ...turns]);
      else await updateStudyThread(thread.id, { practiceLanguage }, turns);
      if (spoken) setVoicePractice(true);
      setInput("");
      if (spoken || readAloud) speakReply(answer.text);
    } catch (error) {
      if (!abort.signal.aborted)
        toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      controller.current = null;
      setBusy(false);
    }
  }

  function speakReply(text: string) {
    const synthesis = window.speechSynthesis;
    if (!synthesis) return;
    const lang = language.trim() || navigator.language;
    const deviceVoices = synthesis.getVoices().filter((voice) => voice.localService);
    const best =
      deviceVoices.find((voice) => voice.lang.toLowerCase() === lang.toLowerCase()) ??
      deviceVoices.find((voice) => voice.lang.split("-")[0] === lang.toLowerCase().split("-")[0]);
    if (!best) {
      if (deviceVoices.length) toast.info("No installed voice matches the speech language.");
      return;
    }
    const phrase = new SpeechSynthesisUtterance(text);
    phrase.lang = best.lang;
    phrase.voice = best;
    synthesis.cancel();
    synthesis.speak(phrase);
  }

  async function dictate(sendTurn: boolean, startedAt: number) {
    if (voice.current || controller.current) return;
    const capture: VoiceCapture = { abort: new AbortController() };
    voice.current = capture;
    const signal = capture.abort.signal;
    setVoiceState("opening");
    window.speechSynthesis?.cancel();
    try {
      const status = await fetch("/api/study/voice", { signal }).then((response) =>
        response.json(),
      );
      setVoiceAvailable(status.available === true);
      if (!status.available) throw new Error("Local voice needs whisper-cli and a Whisper model.");
      const recording = await recordStudyVoice(signal);
      capture.stop = recording.stop;
      capture.mute = recording.mute;
      setVoiceState("recording");
      const { audio, seconds } = await recording.result;
      signal.throwIfAborted();
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
          send(transcript, startedAt + Math.round(seconds * 1000), true),
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

  async function report(generatedAt: number) {
    if (controller.current) return;
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const history = conversation.map(({ entry }) => entry);
      const context = {
        ...thread,
        messages: history,
        practiceLanguage: language.trim() || undefined,
      };
      const topic = history
        .filter(({ role }) => role === "user")
        .slice(-3)
        .map(({ text }) => text)
        .join(" ");
      const result = await askStudyModel({
        action: "report",
        input: "Write a report on the study conversation.",
        passages: passagesFor(context, book, topic, vaultNotes),
        thread: context,
        signal: abort.signal,
      });
      if (!abort.signal.aborted && result.report) {
        const requested = thread.corrections && thread.corrections !== "off";
        const hasLanguageEvidence = conversation.some(
          ({ entry }) => entry.role === "user" && entry.text.trim().split(/\s+/).length >= 5,
        );
        const languageStatus = requested
          ? hasLanguageEvidence
            ? "reviewed"
            : "insufficient"
          : "not-requested";
        await save({
          practiceLanguage: language.trim() || undefined,
          report: {
            ...result.report,
            generatedAt,
            languageStatus,
            languageFeedback: languageStatus === "reviewed" ? result.report.languageFeedback : [],
            vocabulary: languageStatus === "reviewed" ? result.report.vocabulary : [],
          },
        });
        setShowReport(true);
        setVoicePractice(false);
        setTemporaryTurns([]);
      }
    } catch (error) {
      if (!abort.signal.aborted)
        toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      controller.current = null;
      setBusy(false);
    }
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
          {book && (
            <StudyOriginLink origin={{ kind: "book", bookId: book.id, section: thread.section }} />
          )}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRenaming(!renaming)}>
            Rename
          </Button>
          <Button variant="outline" size="sm" onClick={setup}>
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
          Context
          <select
            aria-label="Context"
            className={optionClass}
            disabled={workPending}
            value={thread.scope}
            onChange={(event) => void save({ scope: event.target.value as StudyThread["scope"] })}
          >
            {studyScopes
              .filter(
                (scope) =>
                  scope === "general" ||
                  scope === "notes" ||
                  (book && (scope !== "passage" || thread.quote)),
              )
              .map((scope) => (
                <option value={scope} key={scope}>
                  {scopeLabels[scope]}
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
        {thread.scope === "notes" ? (
          <fieldset className="flex max-h-40 flex-wrap gap-2 overflow-auto">
            <legend className="mb-1 text-sm">Include notes</legend>
            {vaultNotes.length === 0 ? (
              <p className="text-muted-foreground">Create a note in the Notes workspace first.</p>
            ) : null}
            {vaultNotes.map((note) => {
              const chosen = thread.noteIds?.includes(note.id) ?? false;
              return (
                <label key={note.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={chosen}
                    disabled={workPending}
                    onChange={() => {
                      const ids = thread.noteIds ?? [];
                      void save({
                        noteIds: chosen ? ids.filter((id) => id !== note.id) : [...ids, note.id],
                      });
                    }}
                  />
                  {note.title}
                </label>
              );
            })}
          </fieldset>
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
              disabled={busy}
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
          <Button type="submit" disabled={!input.trim() || workPending || !model}>
            {busy ? "Working…" : "Send"}
          </Button>
          {busy ? (
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
          {!voiceState ? (
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
                disabled={busy || !model}
              >
                {voicePractice ? "Record next turn" : "Speak to tutor"}
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
        {voiceState ? (
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
      {conversation.length || thread.report ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {thread.report ? (
              <Button variant="outline" onClick={() => setShowReport(!showReport)}>
                {showReport ? "Hide report" : "Show report"}
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={workPending || !model || !conversation.length}
              onClick={() => void report(Date.now())}
            >
              {voicePractice
                ? "Finish voice practice and generate report"
                : thread.report
                  ? "Regenerate report"
                  : "Generate session report"}
            </Button>
          </div>
          {showReport && thread.report ? (
            <StudySessionReport
              report={thread.report}
              onDraftCard={(text) => draftCards(text, { kind: "report", threadId: thread.id })}
              onFeedback={(key, value) => {
                const report = thread.report;
                if (report)
                  void save({
                    report: { ...report, feedback: { ...report.feedback, [key]: value } },
                  });
              }}
              onSaveCard={(front, back, key) =>
                makeCard(
                  front,
                  back,
                  { kind: "report", threadId: thread.id },
                  `report-card-${thread.id}-${thread.report?.generatedAt ?? 0}-${key}`,
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
                    origin: { kind: "report", threadId: thread.id },
                  },
                  `report-word-${thread.id}-${thread.report?.generatedAt ?? 0}-${key}`,
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
                const report = thread.report;
                if (!report) return;
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
                  { kind: "report", threadId: thread.id },
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
                    studyHref("cards", thread.notebookId ? { notebook: thread.notebookId } : {}),
                  ),
              },
            })
          }
        />
      ) : null}
    </section>
  );
}
