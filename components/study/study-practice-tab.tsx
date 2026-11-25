import {
  ArrowDown01Icon,
  ComputerProgramming01Icon,
  Delete02Icon,
  LanguageSkillIcon,
  MeetingRoomIcon,
  PlusSignIcon,
  QuillWrite01Icon,
  TeachingIcon,
} from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DirectionalText } from "@/components/common/directional-text";
import { Icon, type IconSvgElement } from "@/components/icon";
import { AIModelPicker } from "@/components/ai/ai-model-picker";
import { Segmented } from "@/components/common/segmented";
import { Button, buttonVariants } from "@/components/panelui/button";
import { Select } from "@/components/panelui/select";
import { Switch } from "@/components/panelui/switch";
import { putStudyRecords, removeStudyRecord, studyConversationDefaults, studyId } from "@/lib/db/study";
import { modelFor, updateSettings, useSettings } from "@/lib/db/settings";
import { deletePracticeSession } from "@/lib/db/writing-practice";
import { studyHref } from "@/lib/study/links";
import { practiceSuggestion, type WrittenMode } from "@/lib/study/practice-suggestion";
import type { PracticeSetupDraft } from "@/lib/study/writing-practice-drafts";
import type { Note } from "@/lib/db/types";
import { goalLabel, isPracticeThread, threadReaderBook, type PracticeGoal } from "@/lib/study/practice";
import {
  studyCorrections,
  studyScopes,
  type StudyBook,
  type StudyPractice,
  type StudyRecordOf,
  type StudyThread,
} from "@/lib/study/records";
import { studyReturnState } from "@/lib/study/return-links";
import { cn } from "@/lib/utils";
import { PracticeSetup } from "./practice/practice-setup";
import {
  modeIcons,
  sessionMode,
  usePracticeSessionSummary,
  useWritingPractice,
  WritingPracticeSession,
} from "./practice/study-writing-practice";
import { materialChanges, simulationGoal, tutorMaterialOptions, TutorOutputs } from "./study-tutor";
import {
  TutorMaterialPicker,
  availableTutorSelection,
  emptyTutorSelection,
  tutorSelectionCount,
  type TutorMaterial,
  type TutorMaterialSelection,
} from "./tutor-material-picker";
import { StudyAcrossVaultsSwitch } from "./study-vault-scope";

const goalIcons: Record<PracticeGoal, IconSvgElement> = {
  "teach-back": TeachingIcon,
  "meeting-simulation": MeetingRoomIcon,
  "technical-interview": ComputerProgramming01Icon,
  language: LanguageSkillIcon,
};

type Scope = Exclude<StudyThread["scope"], "passage" | "image">;
const startScopes = studyScopes.filter((value): value is Scope => value !== "passage" && value !== "image");

type Materials = {
  books: StudyBook[];
  notes: Note[];
  cards: StudyRecordOf<"card">[];
  notebookSources: TutorMaterial[];
  vaultHighlights: TutorMaterial[];
};

/**
 * What a new session is about: a practice exercise, or a conversation about some material.
 * `chosen` is material picked in advance, e.g. a notebook's documents.
 */
type Setup =
  | { kind: "practice"; goal: PracticeGoal; chosen?: Pick<TutorMaterialSelection, "bookIds" | "sourceIds"> }
  | { kind: "conversation" };

/** Material chosen in advance: a notebook's documents and sources, for "Practise this subject". */
export type PracticePreset = { key: string; bookIds: string[]; sourceIds: string[] };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-44 gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** Starts a session: the material it draws on, then a new thread (or a flashcard practice). */
function SessionSetup({
  setup,
  materials,
  vaultId,
  open,
  practice,
  openingPractice,
  cancel,
  embedded = false,
}: {
  setup: Setup;
  materials: Materials;
  vaultId: string;
  open: (thread: StudyThread) => void;
  practice: (ids: string[]) => void;
  openingPractice: boolean;
  cancel?: () => void;
  /** Inside the Practice page's exercise row: no frame or heading, and no Cancel. */
  embedded?: boolean;
}) {
  const { t } = useTranslation("home");
  const { t: common } = useTranslation();
  const { books, notes, cards, notebookSources, vaultHighlights } = materials;
  const practising = setup.kind === "practice";
  const [scope, setScope] = useState<Scope>(
    practising && setup.goal === "teach-back" ? "materials" : practising ? "general" : "book",
  );
  const [bookId, setBookId] = useState("");
  const chosen = setup.kind === "practice" ? setup.chosen : undefined;
  const [materialSelection, setSelection] = useState(() => ({ ...emptyTutorSelection, ...chosen }));
  const formRef = useRef<HTMLFormElement>(null);
  const revealed = Boolean(chosen);
  useEffect(() => {
    if (revealed) formRef.current?.scrollIntoView({ block: "center" });
  }, [revealed]);
  const [starting, setStarting] = useState(false);
  const goal: StudyThread["goal"] = practising ? setup.goal : scope === "general" ? "general" : "book";
  const cardPractice = scope === "cards";
  const curated = scope === "notes" || scope === "materials" || cardPractice;
  const simulation = cardPractice ? undefined : simulationGoal(goal);
  const scopes = startScopes.filter((value) => value !== "cards" || goal === "teach-back");
  const readableBooks = useMemo(() => books.filter(({ sections }) => sections.some(({ text }) => text.trim())), [books]);
  const readableNotes = useMemo(() => notes.filter(({ body }) => body.trim()), [notes]);
  const selection = { ...emptyTutorSelection, ...materialChanges(scope, materialSelection) };
  const materialOptions = tutorMaterialOptions(
    scope,
    readableBooks,
    readableNotes,
    notebookSources,
    vaultHighlights,
    cards,
    selection,
  );
  const selected = availableTutorSelection(materialOptions, selection);
  const selectedCount = tutorSelectionCount(selected);
  const needsDocument = scope === "book" || scope === "chapter";
  const ready = (!curated || selectedCount > 0) && (!needsDocument || Boolean(bookId));
  const scopeLabel = (value: Scope) =>
    value === "materials"
      ? t("study.materials.scope")
      : value === "cards"
        ? t("study.materials.cards")
        : t(`study.practice.scopes.${value}`);
  const heading = practising
    ? t("study.practice.chosen", { goal: t(`study.goals.labels.${setup.goal}`) })
    : t("study.practice.conversationTitle");

  function start() {
    if (!ready || starting) return;
    if (cardPractice) {
      practice(selected.cardIds);
      return;
    }
    const book = needsDocument ? books.find((item) => item.id === bookId) : undefined;
    const materialTitle = curated
      ? (readableBooks.find(({ id }) => id === selected.bookIds[0])?.title ??
        notebookSources.find(({ id }) => id === selected.sourceIds[0])?.title ??
        vaultHighlights.find(({ id }) => id === selected.highlightIds[0])?.title ??
        readableNotes.find(({ id }) => id === selected.noteIds[0])?.title)
      : undefined;
    const subject =
      materialTitle && selectedCount > 1
        ? t("study.materials.threadTitle", { title: materialTitle, count: selectedCount - 1 })
        : (materialTitle ?? book?.title);
    const name = t(`study.goals.labels.${goal}`);
    const thread: StudyThread = {
      id: studyId(),
      kind: "thread",
      title: subject ? `${name} · ${subject}` : name,
      goal,
      scope,
      messages: [],
      vaultId,
      bookId: book?.id,
      section: scope === "chapter" ? book?.section : undefined,
      ...(curated ? selected : {}),
      notebookId: book?.notebookId,
      updatedAt: Date.now(),
    };
    setStarting(true);
    void studyConversationDefaults(goal)
      .then((defaults) => putStudyRecords({ ...thread, ...defaults }))
      .then(() => open(thread))
      .catch((error: Error) => {
        toast.error(error.message);
        setStarting(false);
      });
  }

  return (
    <form
      ref={formRef}
      aria-label={heading}
      className={embedded ? "grid gap-4" : "grid gap-4 rounded-2xl border bg-background p-4 dark:bg-muted/30"}
      onSubmit={(event) => {
        event.preventDefault();
        start();
      }}
    >
      {embedded ? null : <h4 className="text-sm font-semibold">{heading}</h4>}
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("study.materials.context")}>
          <Select
            items={scopes.map((value) => ({ value, label: scopeLabel(value) }))}
            value={scope}
            onValueChange={(next) => {
              const choice = scopes.find((value) => value === next);
              if (choice) setScope(choice);
            }}
          >
            <Select.Trigger aria-label={t("study.materials.context")}>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {scopes.map((value) => (
                <Select.Item key={value} value={value}>
                  {scopeLabel(value)}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </Field>
        {needsDocument ? (
          <Field label={t("study.goals.document")}>
            <Select
              items={[
                { value: "", label: t("study.goals.chooseDocument") },
                ...books.map(({ id, title }) => ({ value: id, label: title })),
              ]}
              value={bookId}
              onValueChange={(next) => setBookId(typeof next === "string" ? next : "")}
            >
              <Select.Trigger aria-label={t("study.goals.document")} className="max-w-72">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {books.map((book) => (
                  <Select.Item key={book.id} value={book.id}>
                    {book.title}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </Field>
        ) : null}
        {curated ? (
          <TutorMaterialPicker
            options={materialOptions}
            selection={selection}
            flashcards={cardPractice}
            onApply={(change) => setSelection((current) => ({ ...current, ...materialChanges(scope, change) }))}
          />
        ) : null}
      </div>
      {simulation ? (
        <p className="text-sm text-muted-foreground">{t(`study.goals.simulation.${simulation}.hint`)}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size={embedded ? "md" : "sm"} disabled={!ready || openingPractice} loading={starting}>
          {t(embedded ? "study.practicePage.start" : "study.practice.start")}
        </Button>
        {cancel ? (
          <Button type="button" size="sm" variant="ghost" onClick={cancel}>
            {common("actions.cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function Preferences() {
  const { t } = useTranslation("home");
  const settings = useSettings();
  const options = [
    { value: "", label: t("study.practice.correctionsByGoal") },
    ...studyCorrections.map((value) => ({ value, label: t(`study.practice.correctionOptions.${value}`) })),
  ];
  return (
    <details className="rounded-2xl border p-3 text-sm">
      <summary className="cursor-pointer font-medium">{t("study.practice.preferences")}</summary>
      <div className="mt-3 grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span>{t("study.practice.corrections")}</span>
          <Select
            items={options}
            value={settings?.study?.corrections ?? ""}
            onValueChange={(next) => {
              const corrections = studyCorrections.find((value) => value === next);
              void updateSettings((saved) => {
                saved.study = { ...saved.study, corrections };
              });
            }}
          >
            <Select.Trigger aria-label={t("study.practice.corrections")} className="w-auto min-w-52">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {options.map(({ value, label }) => (
                <Select.Item key={value} value={value}>
                  {label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        <label className="flex cursor-pointer items-center gap-3">
          <Switch
            checked={settings?.study?.keepVoiceTranscripts ?? false}
            onCheckedChange={(keepVoiceTranscripts) =>
              void updateSettings((saved) => {
                saved.study = { ...saved.study, keepVoiceTranscripts };
              })
            }
          />
          {t("study.practice.keepTranscripts")}
        </label>
        <StudyAcrossVaultsSwitch />
      </div>
    </details>
  );
}

function ThreadList({
  threads,
  books,
  cards,
  vaultId,
  open,
  remove,
}: {
  threads: StudyThread[];
  books: StudyBook[];
  cards: StudyRecordOf<"card">[];
  vaultId: string;
  open: (thread: StudyThread) => void;
  remove: (thread: StudyThread) => void;
}) {
  const { t } = useTranslation("home");
  const location = useLocation();
  const threadCards = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { origin } of cards)
      if (origin?.kind === "tutor") counts.set(origin.threadId, (counts.get(origin.threadId) ?? 0) + 1);
    return counts;
  }, [cards]);
  return (
    <ul className="divide-y rounded-2xl border">
      {threads.map((thread) => {
        const book = thread.bookId ? books.find(({ id }) => id === thread.bookId) : undefined;
        const detail = [
          goalLabel(thread, t(`study.goals.labels.${thread.goal}`)),
          book?.title,
          threadReaderBook(thread, books) ? t("study.practice.inReader") : undefined,
        ].filter(Boolean).join(" · ");
        return (
          <li className="flex items-start justify-between gap-2 p-4" key={thread.id}>
            <div className="min-w-0 flex-1 space-y-2">
              <button
                type="button"
                className="block min-w-0 cursor-pointer text-start font-medium wrap-break-word outline-none hover:underline focus-visible:underline"
                onClick={() => open(thread)}
              >
                <DirectionalText as="span" text={thread.title} />
              </button>
              {detail ? (
                <p className="text-xs text-muted-foreground" dir="auto">
                  {detail}
                </p>
              ) : null}
              <TutorOutputs
                thread={thread}
                cardCount={threadCards.get(thread.id) ?? 0}
                vaultId={vaultId}
                returnState={studyReturnState(location.state)}
              />
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("study.practice.deleteLabel", { title: thread.title })}
              title={t("study.practice.delete")}
              onClick={() => remove(thread)}
            >
              <Icon icon={Delete02Icon} size={16} />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

type Exercise = "teach" | "questions" | "roleplay";
type AnswerMode = "write" | "speak";
const roleplayGoals = ["meeting-simulation", "technical-interview", "language"] as const satisfies readonly PracticeGoal[];
type RoleplayGoal = (typeof roleplayGoals)[number];
const exerciseIcons: Record<Exercise, IconSvgElement> = {
  teach: TeachingIcon,
  questions: QuillWrite01Icon,
  roleplay: MeetingRoomIcon,
};

/** One finished or unfinished run, written or spoken, for the history. */
type HistoryEntry =
  | { kind: "written"; id: string; at: number; session: StudyPractice }
  | { kind: "spoken"; id: string; at: number; thread: StudyThread };

/**
 * The Practice page, exercise first: one suggestion, the three exercises as
 * rows (the chosen one opens with its material and Start practice), and one
 * history of every run. Explain it back and Questions are written (or spoken)
 * sessions; Role-play is a spoken conversation in a setting.
 */
export function StudyPracticeTab({
  threads,
  books,
  notes,
  cards,
  notebookSources,
  vaultHighlights,
  vaultId,
  open,
  practice,
  openingPractice,
  setupModel,
  preset,
}: Materials & {
  threads: StudyThread[];
  vaultId: string;
  /** Opens Settings → AI providers. */
  setupModel?: () => void;
  /** Opens a thread: beside its document when it is a question about one, here otherwise. */
  open: (thread: StudyThread) => void;
  practice: (cardIds: string[]) => void;
  openingPractice: boolean;
  /** Opens Explain it back on this material, once per preset. */
  preset?: PracticePreset;
}) {
  const { t } = useTranslation("home");
  const settings = useSettings();
  const written = useWritingPractice(vaultId);
  const sessions = useMemo(() => written.sessions ?? [], [written.sessions]);
  const practiceThreads = useMemo(() => threads.filter(isPracticeThread), [threads]);
  const conversations = useMemo(() => threads.filter((thread) => !isPracticeThread(thread)), [threads]);
  const hasHistory = sessions.length > 0 || practiceThreads.length > 0;
  const [exercise, setExercise] = useState<Exercise>();
  const chosen: Exercise = exercise ?? (hasHistory ? "questions" : "teach");
  const [answer, setAnswer] = useState<AnswerMode>("write");
  const [setting, setSetting] = useState<RoleplayGoal>("meeting-simulation");
  const [suggested, setSuggested] = useState<{ mode: WrittenMode; preset: Partial<PracticeSetupDraft> }>();
  const [presetKey, setPresetKey] = useState<string>();
  const [spokenChoice, setSpokenChoice] = useState<Pick<TutorMaterialSelection, "bookIds" | "sourceIds">>();
  if (preset && preset.key !== presetKey) {
    // "Practise this subject": explain the notebook's documents back, aloud, since they may be sources.
    setPresetKey(preset.key);
    setExercise("teach");
    setAnswer("speak");
    setSpokenChoice({ bookIds: preset.bookIds, sourceIds: preset.sourceIds });
  }
  const [deleting, setDeleting] = useState<HistoryEntry | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [conversing, setConversing] = useState(false);
  const [now] = useState(() => Date.now());
  const suggestion = useMemo(() => practiceSuggestion({ books, sessions, now }), [books, sessions, now]);
  const noModel = settings !== undefined && !modelFor(settings, "writing");
  const noMaterial = books.length === 0 && notes.length === 0 && notebookSources.length === 0 && cards.length === 0;
  const materials = { books, notes, cards, notebookSources, vaultHighlights };
  const writtenMaterials = { books, notes, cards, highlights: vaultHighlights };

  const history = useMemo<HistoryEntry[]>(
    () =>
      [
        ...sessions.map((session) => ({ kind: "written" as const, id: session.id, at: session.updatedAt, session })),
        ...practiceThreads.map((thread) => ({ kind: "spoken" as const, id: thread.id, at: thread.updatedAt, thread })),
      ].toSorted((a, b) => b.at - a.at),
    [sessions, practiceThreads],
  );

  if (written.session)
    return <WritingPracticeSession session={written.session} setup={setupModel} open={written.open} />;

  const exerciseName = (value: Exercise) => t(`study.practicePage.exercises.${value}.name`);
  const choose = (value: Exercise) => {
    setExercise(value);
    setSuggested(undefined);
  };

  return (
    <section className="mx-auto w-full max-w-3xl space-y-10" aria-labelledby="study-practice-title">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="study-practice-title" className="text-2xl font-semibold tracking-tight">
          {t("study.practice.title")}
        </h2>
        {/* Questions, feedback and explaining it back remember their own model. */}
        <AIModelPicker use="writing" appearance="outline" side="bottom" align="end" />
      </header>

      {noMaterial ? (
        <NoMaterial vaultId={vaultId} />
      ) : (
        <>
          {suggestion ? (
            <Suggestion
              suggestion={suggestion}
              disabled={noModel}
              resume={(id) => written.open(id)}
              start={(mode, book, section) => {
                setExercise(mode);
                setAnswer("write");
                setSuggested({ mode, preset: { source: "book", bookId: book.id, section, sectionEnd: section } });
              }}
            />
          ) : null}

          <section className="space-y-3" aria-labelledby="study-practice-choose">
            <h3 id="study-practice-choose" className="text-sm font-medium text-muted-foreground">
              {t(suggestion ? "study.practicePage.orChoose" : "study.practicePage.choose")}
            </h3>
            <div role="radiogroup" aria-labelledby="study-practice-choose" className="space-y-2">
              {(["teach", "questions", "roleplay"] as const).map((value) => {
                const on = value === chosen;
                return (
                  <div
                    key={value}
                    className={cn(
                      "rounded-2xl border transition-colors",
                      on ? "border-input bg-foreground/[0.03]" : "border-border",
                    )}
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => choose(value)}
                      className="flex min-h-17 w-full cursor-pointer items-start gap-4 rounded-2xl px-5 py-3.5 text-start outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full border",
                          on ? "border-foreground bg-foreground" : "border-muted-foreground",
                        )}
                      >
                        <span className={cn("size-1.5 rounded-full", on ? "bg-background" : "bg-transparent")} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-[0.9375rem] font-medium">
                          <Icon icon={exerciseIcons[value]} size={16} className="text-muted-foreground" />
                          {exerciseName(value)}
                        </span>
                        <span className="mt-0.5 block text-sm text-pretty text-muted-foreground">
                          {t(`study.practicePage.exercises.${value}.line`)}
                        </span>
                      </span>
                      <span className="hidden shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums sm:block">
                        {t(`study.practicePage.exercises.${value}.length`)}
                      </span>
                    </button>
                    {on ? (
                      <div className="space-y-5 px-5 pt-1 pb-5">
                        {value === "roleplay" ? (
                          <>
                            <Segmented<RoleplayGoal>
                              size="sm"
                              aria-label={t("study.practicePage.setting")}
                              value={setting}
                              onValueChange={setSetting}
                              options={roleplayGoals.map((goal) => ({
                                value: goal,
                                label: t(`study.practicePage.settings.${goal}`),
                              }))}
                            />
                            <SessionSetup
                              key={setting}
                              setup={{ kind: "practice", goal: setting }}
                              materials={materials}
                              vaultId={vaultId}
                              open={open}
                              practice={practice}
                              openingPractice={openingPractice}
                              embedded
                            />
                          </>
                        ) : (
                          <>
                            {value === "teach" ? (
                              <Segmented<AnswerMode>
                                size="sm"
                                aria-label={t("study.practicePage.answerMode")}
                                value={answer}
                                onValueChange={setAnswer}
                                options={[
                                  { value: "write", label: t("study.practicePage.answerModes.write") },
                                  { value: "speak", label: t("study.practicePage.answerModes.speak") },
                                ]}
                              />
                            ) : null}
                            {value === "teach" && answer === "speak" ? (
                              <SessionSetup
                                key={`speak:${presetKey ?? ""}`}
                                setup={{ kind: "practice", goal: "teach-back", chosen: spokenChoice }}
                                materials={materials}
                                vaultId={vaultId}
                                open={open}
                                practice={practice}
                                openingPractice={openingPractice}
                                embedded
                              />
                            ) : (
                              <PracticeSetup
                                key={`${value}:${suggested?.mode === value ? JSON.stringify(suggested.preset) : ""}`}
                                mode={value}
                                vaultId={vaultId}
                                materials={writtenMaterials}
                                setup={setupModel}
                                created={(session) => written.open(session.id)}
                                embedded
                                preset={suggested?.mode === value ? suggested.preset : undefined}
                                autoStart={suggested?.mode === value}
                              />
                            )}
                          </>
                        )}
                        {noModel ? <NoModel setup={setupModel} /> : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      <section className="space-y-3" aria-labelledby="study-practice-history">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="study-practice-history" className="text-sm font-medium text-muted-foreground">
            {t("study.practicePage.history")}
          </h3>
          {history.length ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("study.practicePage.sessions", { count: history.length })}
            </span>
          ) : null}
        </div>
        {history.length ? (
          <>
            <ul className="divide-y rounded-2xl border">
              {(showAll ? history : history.slice(0, 8)).map((entry) => (
                <HistoryRow
                  key={entry.id}
                  entry={entry}
                  open={() => (entry.kind === "written" ? written.open(entry.id) : open(entry.thread))}
                  remove={() => setDeleting(entry)}
                />
              ))}
            </ul>
            {!showAll && history.length > 8 ? (
              <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                {t("study.practicePage.showAll", { count: history.length })}
              </Button>
            ) : null}
          </>
        ) : (
          <div className="rounded-2xl border border-dashed px-5 py-6">
            <p className="text-sm font-medium">{t("study.practicePage.noHistory.title")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("study.practicePage.noHistory.body")}</p>
          </div>
        )}
        {written.missing ? (
          <p className="text-sm text-muted-foreground">{t("study.writingPractice.home.missing")}</p>
        ) : null}
      </section>

      <details className="group space-y-3" open={conversing || undefined}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium text-muted-foreground outline-none focus-visible:underline [&::-webkit-details-marker]:hidden">
          <Icon icon={ArrowDown01Icon} size={16} className="transition-transform group-open:rotate-180" />
          {t("study.practicePage.conversations", { count: conversations.length })}
        </summary>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("study.practice.conversationsHint")}</p>
          <Button
            size="sm"
            variant="outline"
            aria-pressed={conversing}
            onClick={() => setConversing((current) => !current)}
          >
            <Icon icon={PlusSignIcon} size={16} />
            {t("study.practice.newConversation")}
          </Button>
          {conversing ? (
            <SessionSetup
              setup={{ kind: "conversation" }}
              materials={materials}
              vaultId={vaultId}
              open={open}
              practice={practice}
              openingPractice={openingPractice}
              cancel={() => setConversing(false)}
            />
          ) : null}
          {conversations.length ? (
            <ThreadList
              threads={conversations}
              books={books}
              cards={cards}
              vaultId={vaultId}
              open={open}
              remove={(thread) => setDeleting({ kind: "spoken", id: thread.id, at: thread.updatedAt, thread })}
            />
          ) : null}
        </div>
      </details>

      <Preferences />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title={t(deleting?.kind === "written" ? "study.writingPractice.home.deleteTitle" : "study.practice.deleteTitle")}
        body={t(deleting?.kind === "written" ? "study.writingPractice.home.deleteBody" : "study.followUps.deleteConversationBody")}
        confirmLabel={t("study.practice.delete")}
        onConfirm={async () => {
          if (deleting?.kind === "written") await deletePracticeSession(deleting.id);
          else if (deleting) await removeStudyRecord(deleting.id);
          setDeleting(null);
        }}
      />
    </section>
  );
}

/** The one suggestion: finish what was left, or practise what was read last. */
function Suggestion({
  suggestion,
  disabled,
  resume,
  start,
}: {
  suggestion: NonNullable<ReturnType<typeof practiceSuggestion>>;
  disabled: boolean;
  resume: (id: string) => void;
  start: (mode: WrittenMode, book: StudyBook, section: number | undefined) => void;
}) {
  const { t, i18n } = useTranslation("home");
  const [now] = useState(() => Date.now());
  let title: string;
  let detail: string;
  if (suggestion.kind === "resume") {
    title = t("study.practicePage.suggestion.resume", { title: suggestion.session.title });
    detail = suggestion.total
      ? t("study.practicePage.suggestion.progress", { answered: suggestion.answered, total: suggestion.total })
      : t("study.practicePage.suggestion.notSent");
  } else {
    const { book, section, mode, readAt } = suggestion;
    const material = section !== undefined ? (book.sections[section]?.title || book.title) : book.title;
    title = t(`study.practicePage.suggestion.${mode}`, { material });
    detail = [
      section !== undefined && material !== book.title ? book.title : "",
      relativeDay(readAt, now, i18n.language, t),
      t(`study.practicePage.suggestion.minutes.${mode}`),
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return (
    <section
      aria-label={t("study.practicePage.suggestion.label")}
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border bg-card px-5 py-4"
    >
      <p className="min-w-0 flex-1 text-sm">
        <span className="text-muted-foreground">{t("study.practicePage.suggestion.label")}: </span>
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground"> · {detail}</span>
      </p>
      <Button
        disabled={disabled}
        onClick={() =>
          suggestion.kind === "resume"
            ? resume(suggestion.session.id)
            : start(suggestion.mode, suggestion.book, suggestion.section)
        }
      >
        {t(suggestion.kind === "resume" ? "study.practicePage.suggestion.continue" : "study.practicePage.suggestion.start")}
      </Button>
    </section>
  );
}

function relativeDay(at: number, now: number, language: string, t: (key: "study.practicePage.suggestion.readToday" | "study.practicePage.suggestion.readYesterday" | "study.practicePage.suggestion.readOn", options?: { date: string }) => string) {
  const day = (time: number) => new Date(time).toDateString();
  if (day(at) === day(now)) return t("study.practicePage.suggestion.readToday");
  if (day(at) === day(now - 24 * 60 * 60 * 1000)) return t("study.practicePage.suggestion.readYesterday");
  return t("study.practicePage.suggestion.readOn", {
    date: new Intl.DateTimeFormat(language, { month: "short", day: "numeric" }).format(at),
  });
}

/** A row of the history: the exercise and material, when, and how it went. */
function HistoryRow({ entry, open, remove }: { entry: HistoryEntry; open: () => void; remove: () => void }) {
  const { t, i18n } = useTranslation("home");
  const summary = usePracticeSessionSummary();
  const date = new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric" }).format(entry.at);
  let name: string;
  let material: string;
  let result: string;
  let icon: IconSvgElement;
  if (entry.kind === "written") {
    const mode = sessionMode(entry.session);
    icon = modeIcons[mode];
    name = t(`study.practicePage.exercises.${mode}.name`);
    material = entry.session.material.label || entry.session.title;
    result = summary(entry.session);
  } else {
    const { thread } = entry;
    icon = goalIcons[thread.goal as PracticeGoal] ?? TeachingIcon;
    name =
      thread.goal === "teach-back"
        ? t("study.practicePage.exercises.teach.name")
        : t("study.practicePage.roleplayIn", { setting: t(`study.practicePage.settings.${thread.goal as RoleplayGoal}`) });
    const label = t(`study.goals.labels.${thread.goal}`);
    material = thread.title.startsWith(`${label} · `) ? thread.title.slice(label.length + 3) : thread.title;
    result = t("study.practicePage.turns", {
      count: thread.messages.filter((message) => message.role === "user").length,
    });
  }
  return (
    <li className="flex items-center gap-2 pe-2">
      <button
        type="button"
        onClick={open}
        className="flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-2xl px-4 py-2 text-start outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <Icon icon={icon} size={16} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-sm">
          <span className="font-medium">{name}</span>
          <span className="text-muted-foreground"> · </span>
          <DirectionalText as="span" text={material} className="text-muted-foreground" />
        </span>
        <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:block">{date}</span>
        <span className="w-28 shrink-0 truncate text-end text-xs text-muted-foreground tabular-nums">{result}</span>
      </button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t("study.practice.deleteLabel", { title: `${name} · ${material}` })}
        onClick={remove}
      >
        <Icon icon={Delete02Icon} size={16} />
      </Button>
    </li>
  );
}

function NoMaterial({ vaultId }: { vaultId: string }) {
  const { t } = useTranslation("home");
  return (
    <section className="space-y-6 rounded-2xl border px-6 py-8">
      <div className="space-y-1">
        <h3 className="text-base font-medium">{t("study.practicePage.noMaterial.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("study.practicePage.noMaterial.body")}</p>
      </div>
      <Link to={studyHref("library", { vault: vaultId })} className={buttonVariants({ size: "md" })}>
        <Icon icon={PlusSignIcon} size={16} />
        {t("study.practicePage.noMaterial.add")}
      </Link>
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{t("study.practicePage.noMaterial.then")}</p>
        <ul className="space-y-2">
          {(["teach", "questions", "roleplay"] as const).map((value) => (
            <li key={value} className="flex gap-3 text-sm">
              <Icon icon={exerciseIcons[value]} size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span>
                <span className="font-medium">{t(`study.practicePage.exercises.${value}.name`)}</span>
                <span className="text-muted-foreground"> · {t(`study.practicePage.exercises.${value}.short`)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function NoModel({ setup }: { setup?: () => void }) {
  const { t } = useTranslation("home");
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm">
      <p className="min-w-0 flex-1 text-muted-foreground">{t("study.practicePage.noModel")}</p>
      {setup ? (
        <Button variant="ghost" size="sm" onClick={setup}>
          {t("study.practicePage.addKey")}
        </Button>
      ) : null}
    </div>
  );
}
