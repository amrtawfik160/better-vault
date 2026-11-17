import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
import { createNote, useNotes } from "@/lib/db/notes";
import {
  freshSchedule,
  putStudyRecords,
  recordStudyActivity,
  removeStudyRecord,
  studyId,
} from "@/lib/db/study";
import { currentVaultId } from "@/lib/db/vaults";
import { askStudyModel, passagesFor } from "@/lib/study/client";
import {
  studyCorrections,
  studyGoals,
  studyScopes,
  type StudyBook,
  type StudyThread,
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

type Recognition = {
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
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
            corrections: goal === "language" ? "live" : "off",
            messages: [],
            bookId: book?.id,
            notebookId: scope === "book" || scope === "chapter" ? book?.notebookId : undefined,
            updatedAt: Date.now(),
          };
          void putStudyRecords(thread)
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
  locate,
  back,
  setup,
}: {
  thread: StudyThread;
  book?: StudyBook;
  locate: (bookId: string, section: number) => void;
  back: () => void;
  setup: () => void;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const [showReport, setShowReport] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const [language, setLanguage] = useState("");
  const controller = useRef<AbortController | null>(null);
  const mic = useRef<Recognition | null>(null);
  const notes = useNotes();
  const settings = useSettings();
  const model = settings ? activeModel(settings) : null;
  const models = settings ? availableModels(settings) : [];
  const vaultId = currentVaultId();
  const vaultNotes = (notes ?? []).filter((note) => note.vaultId === vaultId);

  useEffect(
    () => () => {
      controller.current?.abort();
      mic.current?.stop();
      window.speechSynthesis?.cancel();
    },
    [],
  );

  async function save(change: Partial<StudyThread>) {
    await putStudyRecords({ ...thread, ...change, updatedAt: Date.now() });
  }

  async function send(message: string, submittedAt: number, aloud = readAloud) {
    const text = message.trim();
    if (!text || busy) return;
    if (thread.scope === "notes" && !thread.noteIds?.length) {
      toast.error("Choose at least one note first.");
      return;
    }
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    const pending: StudyThread = {
      ...thread,
      messages: [...thread.messages, { role: "user", text }],
      updatedAt: submittedAt,
    };
    const passages = passagesFor(thread, book, text);
    const grounding =
      thread.scope === "notes"
        ? vaultNotes
            .filter((note) => thread.noteIds?.includes(note.id))
            .map(({ title, body }) => ({ title, text: body }))
        : passages;
    try {
      const answer = await askStudyModel("chat", text, grounding, thread, abort.signal);
      if (abort.signal.aborted) return;
      const citations = [...new Set(answer.citations ?? [])].flatMap((index) => {
        const passage = passages[index - 1];
        return passage
          ? [{ index, bookId: passage.bookId, section: passage.section, title: passage.title }]
          : [];
      });
      const next: StudyThread = {
        ...pending,
        messages: [...pending.messages, { role: "assistant", text: answer.text, citations }],
      };
      await putStudyRecords(next);
      setInput("");
      if (aloud && "speechSynthesis" in window) {
        const phrase = new SpeechSynthesisUtterance(answer.text);
        if (language) phrase.lang = language;
        window.speechSynthesis.speak(phrase);
      }
    } catch (error) {
      if (!abort.signal.aborted)
        toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      controller.current = null;
      setBusy(false);
    }
  }

  function dictate(started: number, sendTurn = false) {
    const platform = window as SpeechWindow;
    const SpeechRecognition = platform.SpeechRecognition ?? platform.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Speech recognition is unavailable in this browser.");
      return;
    }
    if (mic.current) {
      mic.current.stop();
      return;
    }
    const recognition = new SpeechRecognition();
    if (language) recognition.lang = language;
    recognition.onresult = ({ results }) => {
      const transcript = results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        if (sendTurn) void send(transcript, Date.now(), true);
        else setInput((value) => (value ? `${value} ${transcript}` : transcript));
        void recordStudyActivity("speaking", (Date.now() - started) / 1000, thread.notebookId);
      }
    };
    recognition.onerror = ({ error }) => toast.error(`Could not transcribe speech (${error}).`);
    recognition.onend = () => {
      mic.current = null;
      setSpeaking(false);
    };
    try {
      recognition.start();
      mic.current = recognition;
      setSpeaking(true);
    } catch {
      toast.error("Could not start the microphone.");
    }
  }

  async function report() {
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const result = await askStudyModel(
        "report",
        "Write a report on the study conversation.",
        [],
        thread,
        abort.signal,
      );
      if (!abort.signal.aborted && result.report) {
        await save({ report: result.report });
        setShowReport(true);
      }
    } catch (error) {
      if (!abort.signal.aborted)
        toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      controller.current = null;
      setBusy(false);
    }
  }

  function saveNote(text: string) {
    void createNote({ vaultId, notebookId: thread.notebookId, title: thread.title, body: text })
      .then(() => toast.success("Saved to Notes"))
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
            className={optionClass}
            disabled={busy || !models.length}
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
            className={optionClass}
            disabled={busy}
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
            className={optionClass}
            disabled={busy}
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
                    disabled={busy}
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
      {thread.messages.length ? (
        <div className="space-y-3" aria-label="Conversation">
          {thread.messages.map((entry, index) => (
            <div
              key={index}
              className={`max-w-3xl space-y-2 rounded-2xl border p-4 ${entry.role === "user" ? "ms-auto w-fit bg-muted" : "bg-card"}`}
            >
              <p className="text-xs font-semibold text-muted-foreground">
                {entry.role === "user" ? "You" : "Tutor"}
              </p>
              <p dir="auto" className="wrap-break-word whitespace-pre-wrap">
                {entry.text}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {entry.citations?.map((citation) => (
                  <Button
                    variant="outline"
                    size="sm"
                    key={citation.index}
                    onClick={() => locate(citation.bookId, citation.section)}
                  >
                    [{citation.index}] {citation.title}
                  </Button>
                ))}
                {entry.role === "assistant" ? (
                  <Button variant="ghost" size="sm" onClick={() => saveNote(entry.text)}>
                    Save to Notes
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
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
          <Button type="submit" disabled={!input.trim() || busy}>
            {busy ? "Working…" : "Send"}
          </Button>
          {busy ? (
            <Button variant="ghost" onClick={() => controller.current?.abort()}>
              Stop
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => dictate(Date.now())} disabled={busy}>
            {speaking ? "Stop recording" : "Dictate"}
          </Button>
          <Button
            variant="outline"
            onClick={() => dictate(Date.now(), true)}
            disabled={busy || speaking}
          >
            Speak to tutor
          </Button>
          <Input
            className="w-32"
            aria-label="Speech language code"
            placeholder="Language code"
            value={language}
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
      </form>
      {thread.messages.length ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {thread.report ? (
              <Button variant="outline" onClick={() => setShowReport(!showReport)}>
                {showReport ? "Hide report" : "Show report"}
              </Button>
            ) : null}
            <Button variant="outline" disabled={busy} onClick={() => void report()}>
              {thread.report ? "Regenerate report" : "Generate session report"}
            </Button>
          </div>
          {showReport && thread.report ? (
            <div className="space-y-3 rounded-2xl border bg-card p-4">
              <h3 className="font-semibold">Session report</h3>
              <p dir="auto" className="whitespace-pre-wrap">
                {thread.report.summary}
              </p>
              <ul className="space-y-2">
                {thread.report.corrections.map((text, index) => (
                  <li className="flex flex-wrap items-center gap-2" key={index}>
                    <p className="flex-1" dir="auto">
                      {text}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void putStudyRecords({
                          id: studyId(),
                          kind: "card",
                          front: "What should I correct from this study session?",
                          back: text,
                          tags: ["Session report"],
                          updatedAt: Date.now(),
                          schedule: freshSchedule(),
                        })
                          .then(() => toast.success("Flashcard created"))
                          .catch((error: Error) => toast.error(error.message));
                      }}
                    >
                      Save flashcard
                    </Button>
                  </li>
                ))}
              </ul>
              <ul className="list-disc space-y-1 ps-5">
                {thread.report.nextSteps.map((text, index) => (
                  <li key={index} dir="auto">
                    {text}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    saveNote(
                      [
                        thread.report?.summary,
                        ...thread.report!.corrections,
                        ...thread.report!.nextSteps,
                      ].join("\n\n"),
                    )
                  }
                >
                  Save report to Notes
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={thread.report.helpful ?? false}
                  onClick={() =>
                    void save({ report: { ...thread.report!, helpful: !thread.report?.helpful } })
                  }
                >
                  Helpful
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
