import {
  ComputerProgramming01Icon,
  Delete02Icon,
  LanguageSkillIcon,
  MeetingRoomIcon,
  PlusSignIcon,
  TeachingIcon,
} from "@hugeicons/core-free-icons";
import { useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DirectionalText } from "@/components/common/directional-text";
import { Icon, type IconSvgElement } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import { Select } from "@/components/panelui/select";
import { Switch } from "@/components/panelui/switch";
import { putStudyRecords, removeStudyRecord, studyConversationDefaults, studyId } from "@/lib/db/study";
import { updateSettings, useSettings } from "@/lib/db/settings";
import type { Note } from "@/lib/db/types";
import { goalLabel, isPracticeThread, practiceGoals, threadReaderBook, type PracticeGoal } from "@/lib/study/practice";
import {
  studyCorrections,
  studyScopes,
  type StudyBook,
  type StudyRecordOf,
  type StudyThread,
} from "@/lib/study/records";
import { studyReturnState } from "@/lib/study/return-links";
import { cn } from "@/lib/utils";
import { StudyWritingPractice } from "./practice/study-writing-practice";
import { materialChanges, simulationGoal, tutorMaterialOptions, TutorOutputs } from "./study-tutor";
import {
  TutorMaterialPicker,
  availableTutorSelection,
  emptyTutorSelection,
  tutorSelectionCount,
  type TutorMaterial,
} from "./tutor-material-picker";

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

/** What a new session is about: a practice exercise, or a conversation about some material. */
type Setup = { kind: "practice"; goal: PracticeGoal } | { kind: "conversation" };

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
}: {
  setup: Setup;
  materials: Materials;
  vaultId: string;
  open: (thread: StudyThread) => void;
  practice: (ids: string[]) => void;
  openingPractice: boolean;
  cancel: () => void;
}) {
  const { t } = useTranslation("home");
  const { t: common } = useTranslation();
  const { books, notes, cards, notebookSources, vaultHighlights } = materials;
  const practising = setup.kind === "practice";
  const [scope, setScope] = useState<Scope>(
    practising && setup.goal === "teach-back" ? "materials" : practising ? "general" : "book",
  );
  const [bookId, setBookId] = useState("");
  const [materialSelection, setSelection] = useState(emptyTutorSelection);
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
      aria-label={heading}
      className="grid gap-4 rounded-2xl border bg-background p-4 dark:bg-muted/30"
      onSubmit={(event) => {
        event.preventDefault();
        start();
      }}
    >
      <h4 className="text-sm font-semibold">{heading}</h4>
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
        <Button type="submit" size="sm" disabled={!ready || openingPractice} loading={starting}>
          {t("study.practice.start")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={cancel}>
          {common("actions.cancel")}
        </Button>
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

/**
 * The Practice tab: written practice (merged in from its own feature), spoken
 * exercises, and every earlier session and conversation.
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
}: Materials & {
  threads: StudyThread[];
  vaultId: string;
  /** Opens Settings → AI providers. */
  setupModel?: () => void;
  /** Opens a thread: beside its document when it is a question about one, here otherwise. */
  open: (thread: StudyThread) => void;
  practice: (cardIds: string[]) => void;
  openingPractice: boolean;
}) {
  const { t } = useTranslation("home");
  const [setup, setSetup] = useState<Setup>();
  const [writing, setWriting] = useState(false);
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<StudyThread | null>(null);
  const materials = { books, notes, cards, notebookSources, vaultHighlights };
  const matching = threads.filter((thread) => thread.title.toLowerCase().includes(query.trim().toLowerCase()));
  const sessions = matching.filter(isPracticeThread);
  const conversations = matching.filter((thread) => !isPracticeThread(thread));
  const searching = query.trim() !== "";
  const setupForm = (kind: Setup["kind"]) =>
    setup?.kind === kind ? (
      <SessionSetup
        key={setup.kind === "practice" ? setup.goal : "conversation"}
        setup={setup}
        materials={materials}
        vaultId={vaultId}
        open={open}
        practice={practice}
        openingPractice={openingPractice}
        cancel={() => setSetup(undefined)}
      />
    ) : null;

  return (
    <section className="space-y-8" aria-labelledby="study-practice-title">
      <header className="space-y-1">
        <h2 id="study-practice-title" className="text-xl font-semibold">
          {t("study.practice.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("study.practice.intro")}</p>
      </header>

      <StudyWritingPractice
        vaultId={vaultId}
        books={books}
        notes={notes}
        cards={cards}
        highlights={vaultHighlights}
        setup={setupModel}
        onActiveChange={setWriting}
      />

      {writing ? null : (
      <>
      <section className="space-y-3" aria-labelledby="study-practice-speaking">
        <div className="space-y-1">
          <h3 id="study-practice-speaking" className="font-semibold">
            {t("study.practice.speakingTitle")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("study.practice.speakingHint")}</p>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {practiceGoals.map((goal) => {
            const chosen = setup?.kind === "practice" && setup.goal === goal;
            return (
              <li key={goal}>
                <button
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => setSetup(chosen ? undefined : { kind: "practice", goal })}
                  className={cn(
                    "flex h-full w-full cursor-pointer flex-col items-start gap-2 rounded-2xl border bg-card p-4 text-start outline-none",
                    "transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40",
                    chosen && "border-ring bg-muted/60",
                  )}
                >
                  <Icon icon={goalIcons[goal]} size={20} className="text-muted-foreground" />
                  <span className="text-sm font-medium">{t(`study.goals.labels.${goal}`)}</span>
                  <span className="text-xs text-muted-foreground">{t(`study.practice.goalHints.${goal}`)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {setupForm("practice")}
        <Preferences />
      </section>

      {threads.length ? (
        <Input
          type="search"
          aria-label={t("study.practice.search")}
          placeholder={t("study.practice.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}

      <section className="space-y-3" aria-labelledby="study-practice-past">
        <h3 id="study-practice-past" className="font-semibold">
          {t("study.practice.pastTitle")}
        </h3>
        {sessions.length ? (
          <ThreadList
            threads={sessions}
            books={books}
            cards={cards}
            vaultId={vaultId}
            open={open}
            remove={setDeleting}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t(searching ? "study.practice.noMatches" : "study.practice.noPast")}
          </p>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="study-practice-conversations">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <h3 id="study-practice-conversations" className="font-semibold">
              {t("study.practice.conversationsTitle")}
            </h3>
            <p className="text-sm text-muted-foreground">{t("study.practice.conversationsHint")}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            aria-pressed={setup?.kind === "conversation"}
            onClick={() => setSetup(setup?.kind === "conversation" ? undefined : { kind: "conversation" })}
          >
            <Icon icon={PlusSignIcon} size={16} />
            {t("study.practice.newConversation")}
          </Button>
        </div>
        {setupForm("conversation")}
        {conversations.length ? (
          <ThreadList
            threads={conversations}
            books={books}
            cards={cards}
            vaultId={vaultId}
            open={open}
            remove={setDeleting}
          />
        ) : searching && threads.length ? (
          <p className="text-sm text-muted-foreground">{t("study.practice.noMatches")}</p>
        ) : null}
      </section>
      </>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title={t("study.practice.deleteTitle")}
        body={t("study.followUps.deleteConversationBody")}
        confirmLabel={t("study.practice.delete")}
        onConfirm={async () => {
          if (deleting) await removeStudyRecord(deleting.id);
          setDeleting(null);
        }}
      />
    </section>
  );
}
