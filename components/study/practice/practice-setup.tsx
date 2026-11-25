import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/panelui/alert";
import { Button } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import { Select } from "@/components/panelui/select";
import { Textarea } from "@/components/panelui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Note } from "@/lib/db/types";
import { createPracticeSession, readPracticeMaterial, type PracticeMaterialChoice, type PracticeMode } from "@/lib/db/writing-practice";
import {
  maxPracticeLearned,
  maxPracticeScenario,
  studyPracticeAudiences,
  studyPracticeQuestionTypes,
  type StudyBook,
  type StudyPractice,
  type StudyRecordOf,
} from "@/lib/study/records";
import { practiceMaterialBudgets } from "@/lib/study/teach";
import {
  defaultPracticeQuestionCount,
  practiceQuestionLimit,
  practiceRequestPassages,
  practiceWordCount,
} from "@/lib/study/writing-practice";
import { writePracticeQuestions } from "@/lib/study/writing-practice-client";
import {
  readPracticeSetupDraft,
  savePracticeSetupDraft,
  type PracticeSetupDraft,
} from "@/lib/study/writing-practice-drafts";
import { cn } from "@/lib/utils";
import type { TutorMaterial } from "../tutor-material-picker";
import { PracticeError } from "./practice-parts";

export type PracticeMaterials = {
  books: StudyBook[];
  notes: Note[];
  cards: StudyRecordOf<"card">[];
  /** The vault's highlights, as the Practice tab lists them for its pickers. */
  highlights: TutorMaterial[];
};

type Source = PracticeSetupDraft["source"];
const questionSources: Source[] = ["learned", "book", "highlights", "notes", "cards"];
const teachSources: Source[] = ["book", "highlights", "notes"];

function blankDraft(mode: PracticeMode): PracticeSetupDraft {
  return {
    source: mode === "teach" ? "book" : "learned",
    learned: "",
    ids: [],
    audience: mode === "teach" ? "friend" : "technical",
    scenario: "",
    types: ["write"],
    count: defaultPracticeQuestionCount,
  };
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="contents">
        <span className="block font-semibold">{title}</span>
      </legend>
      {hint ? <p className="-mt-2 text-sm text-muted-foreground">{hint}</p> : null}
      {children}
    </fieldset>
  );
}

function Chip({ pressed, onClick, children, role = "button" }: { pressed: boolean; onClick: () => void; children: ReactNode; role?: "button" | "radio" }) {
  return (
    <button
      type="button"
      role={role === "radio" ? "radio" : undefined}
      aria-pressed={role === "button" ? pressed : undefined}
      aria-checked={role === "radio" ? pressed : undefined}
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-xl border bg-card px-3 py-2 text-start text-sm outline-none transition-colors",
        "hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40",
        pressed && "border-ring bg-muted/60 font-medium",
      )}
    >
      {children}
    </button>
  );
}

/** A searchable list of checkboxes for highlights, notes or flashcards. */
function Checklist({
  items,
  selected,
  onChange,
  label,
  empty,
}: {
  items: readonly { id: string; title: string; detail?: string; searchText?: string }[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  label: string;
  empty: string;
}) {
  const { t } = useTranslation("home");
  const [query, setQuery] = useState("");
  const chosen = new Set(selected);
  const term = query.trim().toLowerCase();
  const shown = term
    ? items.filter(({ title, detail, searchText }) => `${title} ${detail ?? ""} ${searchText ?? ""}`.toLowerCase().includes(term))
    : items;
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          size="sm"
          className="max-w-72"
          aria-label={t("study.writingPractice.setup.search", { label })}
          placeholder={t("study.writingPractice.setup.search", { label })}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="text-xs text-muted-foreground">{t("study.writingPractice.setup.selected", { count: chosen.size })}</span>
        {chosen.size ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
            {t("study.writingPractice.setup.clear")}
          </Button>
        ) : null}
      </div>
      <ScrollArea className="h-56 rounded-xl border">
        <ul className="divide-y">
          {shown.map((item) => (
            <li key={item.id}>
              <label className="flex cursor-pointer items-start gap-3 p-3 text-sm hover:bg-muted/50">
                <Checkbox
                  className="mt-0.5"
                  checked={chosen.has(item.id)}
                  onCheckedChange={(checked) =>
                    onChange(checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))
                  }
                />
                <span className="min-w-0">
                  <span className="line-clamp-2" dir="auto">{item.title}</span>
                  {item.detail ? <span className="block text-xs text-muted-foreground" dir="auto">{item.detail}</span> : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}

/**
 * Setting up a session on one calm page: what to practise, who it is for,
 * and, for questions, which kinds and how many. The form is kept in this
 * browser, so "what I learned" survives leaving the page.
 */
export function PracticeSetup({
  mode,
  vaultId,
  materials,
  setup,
  cancel,
  created,
  embedded = false,
  preset,
  autoStart = false,
}: {
  mode: PracticeMode;
  vaultId: string;
  materials: PracticeMaterials;
  setup?: () => void;
  cancel?: () => void;
  created: (session: StudyPractice) => void;
  /** Inside the Practice page's exercise row: no heading, the options folded under More options. */
  embedded?: boolean;
  /** Material chosen in advance (the page's suggestion). */
  preset?: Partial<PracticeSetupDraft>;
  /** Starts at once with the preset, as the suggestion's Start does. */
  autoStart?: boolean;
}) {
  const { t } = useTranslation("home");
  const [draft, setDraft] = useState<PracticeSetupDraft>(() => {
    const saved = { ...(readPracticeSetupDraft(vaultId) ?? blankDraft(mode)), ...preset };
    const sources = mode === "teach" ? teachSources : questionSources;
    return sources.includes(saved.source) ? saved : { ...saved, source: sources[0] };
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const { books, notes, cards, highlights } = materials;
  const book = books.find(({ id }) => id === draft.bookId) ?? books[0];
  const sources = mode === "teach" ? teachSources : questionSources;

  function change(patch: Partial<PracticeSetupDraft>) {
    setDraft((current) => {
      const next = { ...current, ...patch };
      savePracticeSetupDraft(vaultId, next);
      return next;
    });
  }

  const sectionEnd = draft.section === undefined ? undefined : Math.max(draft.section, draft.sectionEnd ?? draft.section);
  const bookLength = useMemo(() => {
    if (!book) return 0;
    const start = draft.section ?? 0;
    const end = draft.section === undefined ? book.sections.length - 1 : (sectionEnd ?? start);
    return book.sections.slice(start, end + 1).reduce((total, { text }) => total + text.length, 0);
  }, [book, draft.section, sectionEnd]);
  const budget = practiceMaterialBudgets[mode].total;

  const choice: PracticeMaterialChoice | undefined =
    draft.source === "learned"
      ? draft.learned.trim()
        ? { kind: "learned", text: draft.learned }
        : undefined
      : draft.source === "book"
        ? book
          ? { kind: "book", bookId: book.id, section: draft.section, sectionEnd: mode === "teach" ? sectionEnd : undefined }
          : undefined
        : draft.ids.length
          ? { kind: draft.source, ids: draft.ids }
          : undefined;

  function materialLabel() {
    switch (draft.source) {
      case "learned":
        return t("study.writingPractice.setup.learnedLabel");
      case "book": {
        if (!book) return "";
        if (draft.section === undefined) return book.title;
        const first = book.sections[draft.section]?.title ?? "";
        const last = mode === "teach" && sectionEnd !== undefined && sectionEnd > draft.section ? book.sections[sectionEnd]?.title : undefined;
        return `${book.title} · ${last ? `${first} – ${last}` : first}`;
      }
      default:
        return t(`study.writingPractice.setup.countLabel.${draft.source}`, { count: draft.ids.length });
    }
  }

  async function start() {
    if (!choice || pending) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(undefined);
    try {
      const material = await readPracticeMaterial(choice, vaultId, mode, draft.scenario);
      if (choice.kind !== "learned" && !material.passages.length) throw new Error(t("study.writingPractice.setup.noText"));
      const label = materialLabel();
      const learned = choice.kind === "learned" ? draft.learned : undefined;
      const scenario = draft.scenario.trim() || undefined;
      const base = {
        vaultId,
        mode,
        audience: draft.audience,
        scenario,
        material: { origins: material.origins, learned, label, sampled: material.sampled || undefined },
        passages: material.passages,
      };
      let session: StudyPractice;
      if (mode === "teach") {
        session = await createPracticeSession({ ...base, title: label, types: ["write"], questions: [] });
      } else {
        const result = await writePracticeQuestions(
          {
            audience: draft.audience,
            scenario,
            passages: practiceRequestPassages({ material: { origins: [], learned }, passages: material.passages }),
            types: draft.types,
            count: draft.count,
            title: label,
          },
          controller.signal,
        );
        session = await createPracticeSession({ ...base, title: result.title || label, types: draft.types, questions: result.questions });
      }
      savePracticeSetupDraft(vaultId, { ...draft, learned: "", ids: [] });
      created(session);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure);
    } finally {
      setPending(false);
      request.current = null;
    }
  }

  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current || !choice) return;
    started.current = true;
    void start();
  });

  if (pending) {
    return (
      <div className="space-y-4 py-10 text-center" role="status">
        <p className="text-lg font-medium">
          {t(mode === "teach" ? "study.writingPractice.setup.preparing" : "study.writingPractice.setup.generating", { count: draft.count })}
        </p>
        <p className="text-sm text-muted-foreground">{t("study.writingPractice.setup.generatingHint")}</p>
        <Button variant="ghost" size="sm" onClick={() => request.current?.abort()}>
          {t("study.writingPractice.cancel")}
        </Button>
      </div>
    );
  }

  const highlightItems = highlights;
  const noteItems = notes.map(({ id, title, body }) => ({ id, title: title || t("study.writingPractice.setup.untitled"), searchText: body.slice(0, 500) }));
  const cardItems = cards.map(({ id, front, back }) => ({ id, title: front, searchText: back }));

  return (
    <div className={embedded ? "space-y-6" : "space-y-8"}>
      <div className={embedded ? "hidden" : "space-y-1"}>
        <h3 className="text-lg font-semibold">
          {t(mode === "teach" ? "study.writingPractice.modes.teach.title" : "study.writingPractice.modes.questions.title")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t(mode === "teach" ? "study.writingPractice.setup.teachIntro" : "study.writingPractice.setup.questionsIntro")}
        </p>
      </div>

      <Group title={t("study.writingPractice.setup.whatTitle")}>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("study.writingPractice.setup.whatTitle")}>
          {sources.map((source) => (
            <Chip key={source} role="radio" pressed={draft.source === source} onClick={() => change({ source, ids: draft.source === source ? draft.ids : [] })}>
              {t(`study.writingPractice.setup.sources.${source}`)}
            </Chip>
          ))}
        </div>

        {draft.source === "learned" ? (
          <div className="space-y-1">
            <Textarea
              size="lg"
              minRows={10}
              maxRows={24}
              dir="auto"
              aria-label={t("study.writingPractice.setup.sources.learned")}
              placeholder={t("study.writingPractice.setup.learnedPlaceholder")}
              maxLength={maxPracticeLearned}
              value={draft.learned}
              onChange={(event) => change({ learned: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              {t("study.writingPractice.words", { count: practiceWordCount(draft.learned) })} · {t("study.writingPractice.setup.learnedHint")}
            </p>
          </div>
        ) : draft.source === "book" ? (
          books.length && book ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                {t("study.writingPractice.setup.document")}
                <Select
                  items={books.map(({ id, title }) => ({ value: id, label: title }))}
                  value={book.id}
                  onValueChange={(next) => typeof next === "string" && change({ bookId: next, section: undefined, sectionEnd: undefined })}
                >
                  <Select.Trigger className="max-w-80">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {books.map(({ id, title }) => (
                      <Select.Item key={id} value={id}>
                        {title}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </label>
              {book.sections.length > 1 ? (
                <SectionSelect
                  label={t(mode === "teach" ? "study.writingPractice.setup.from" : "study.writingPractice.setup.section")}
                  book={book}
                  value={draft.section}
                  allowWhole
                  onChange={(section) => change({ section, sectionEnd: section })}
                />
              ) : null}
              {mode === "teach" && draft.section !== undefined && book.sections.length > 1 ? (
                <SectionSelect
                  label={t("study.writingPractice.setup.to")}
                  book={book}
                  value={sectionEnd}
                  min={draft.section}
                  onChange={(next) => change({ sectionEnd: next })}
                />
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("study.writingPractice.setup.noBooks")}</p>
          )
        ) : draft.source === "highlights" ? (
          <Checklist
            label={t("study.writingPractice.setup.sources.highlights")}
            items={highlightItems}
            selected={draft.ids}
            onChange={(ids) => change({ ids })}
            empty={t("study.writingPractice.setup.noHighlights")}
          />
        ) : draft.source === "notes" ? (
          <Checklist
            label={t("study.writingPractice.setup.sources.notes")}
            items={noteItems}
            selected={draft.ids}
            onChange={(ids) => change({ ids })}
            empty={t("study.writingPractice.setup.noNotes")}
          />
        ) : (
          <Checklist
            label={t("study.writingPractice.setup.sources.cards")}
            items={cardItems}
            selected={draft.ids}
            onChange={(ids) => change({ ids })}
            empty={t("study.writingPractice.setup.noCards")}
          />
        )}
        {draft.source === "book" && bookLength > budget ? (
          <Alert tone="info" variant="plain">
            <Alert.Description>
              {t(mode === "teach" ? "study.writingPractice.setup.longTeach" : "study.writingPractice.setup.longQuestions", {
                pages: Math.max(1, Math.round(bookLength / 3_000)),
              })}
            </Alert.Description>
          </Alert>
        ) : null}
      </Group>

      <MoreOptions
        embedded={embedded}
        summary={[
          t(`study.writingPractice.audiences.${draft.audience}.label`),
          mode === "questions" ? t("study.writingPractice.setup.countSummary", { count: draft.count }) : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      >
      <Group title={t("study.writingPractice.setup.whoTitle")} hint={t("study.writingPractice.setup.whoHint")}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label={t("study.writingPractice.setup.whoTitle")}>
          {studyPracticeAudiences.map((audience) => (
            <Chip key={audience} role="radio" pressed={draft.audience === audience} onClick={() => change({ audience })}>
              <span className="block">{t(`study.writingPractice.audiences.${audience}.label`)}</span>
              <span className="block text-xs font-normal text-muted-foreground">{t(`study.writingPractice.audiences.${audience}.hint`)}</span>
            </Chip>
          ))}
        </div>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">{t("study.writingPractice.setup.scenario")}</span>
          <Textarea
            minRows={2}
            maxRows={5}
            dir="auto"
            maxLength={maxPracticeScenario}
            placeholder={t(mode === "teach" ? "study.writingPractice.setup.teachScenarioPlaceholder" : "study.writingPractice.setup.scenarioPlaceholder")}
            value={draft.scenario}
            onChange={(event) => change({ scenario: event.target.value })}
          />
          <span className="text-xs text-muted-foreground">
            {t("study.writingPractice.setup.scenarioCount", { count: draft.scenario.length, max: maxPracticeScenario })}
          </span>
        </label>
      </Group>

      {mode === "questions" ? (
        <Group title={t("study.writingPractice.setup.typesTitle")} hint={t("study.writingPractice.setup.typesHint")}>
          <div className="flex flex-wrap gap-2">
            {studyPracticeQuestionTypes.map((type) => {
              const on = draft.types.includes(type);
              return (
                <Chip
                  key={type}
                  pressed={on}
                  onClick={() => {
                    const types = on ? draft.types.filter((entry) => entry !== type) : [...draft.types, type];
                    if (types.length) change({ types });
                  }}
                >
                  <span className="block">{t(`study.writingPractice.types.${type}`)}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{t(`study.writingPractice.typeHints.${type}`)}</span>
                </Chip>
              );
            })}
          </div>
          <label className="flex items-center gap-3 text-sm">
            <span className="font-medium">{t("study.writingPractice.setup.count")}</span>
            <Input
              type="number"
              size="sm"
              className="w-20"
              min={1}
              max={practiceQuestionLimit}
              value={draft.count}
              onChange={(event) => {
                const count = Math.round(Number(event.target.value));
                if (count >= 1 && count <= practiceQuestionLimit) change({ count });
              }}
            />
          </label>
        </Group>
      ) : null}

      </MoreOptions>

      {error ? <PracticeError error={error} retry={() => void start()} setup={setup} /> : null}

      {embedded ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!choice} onClick={() => void start()}>
            {t("study.practicePage.start")}
          </Button>
          {!choice ? <p className="text-sm text-muted-foreground">{t(`study.writingPractice.setup.need.${draft.source}`)}</p> : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          {!choice ? <p className="me-auto text-sm text-muted-foreground">{t(`study.writingPractice.setup.need.${draft.source}`)}</p> : null}
          <Button variant="ghost" onClick={cancel}>
            {t("study.writingPractice.cancel")}
          </Button>
          <Button disabled={!choice} onClick={() => void start()}>
            {t(mode === "teach" ? "study.writingPractice.setup.startTeach" : "study.writingPractice.setup.create")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** On the Practice page, who it is for and how many questions fold away, with a one-line summary. */
function MoreOptions({ embedded, summary, children }: { embedded: boolean; summary: string; children: ReactNode }) {
  const { t } = useTranslation("home");
  if (!embedded) return <>{children}</>;
  return (
    <details className="group rounded-xl border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-xl px-4 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
        <span className="font-medium">{t("study.practicePage.moreOptions")}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{summary}</span>
        <Icon icon={ArrowDown01Icon} size={16} className="text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-8 border-t p-4">{children}</div>
    </details>
  );
}

function SectionSelect({
  label,
  book,
  value,
  allowWhole = false,
  min = 0,
  onChange,
}: {
  label: string;
  book: StudyBook;
  value: number | undefined;
  allowWhole?: boolean;
  min?: number;
  onChange: (section: number | undefined) => void;
}) {
  const { t } = useTranslation("home");
  const whole = t("study.writingPractice.setup.wholeDocument");
  const options = [
    ...(allowWhole ? [{ value: "all", label: whole }] : []),
    ...book.sections.flatMap((section, index) => (index >= min ? [{ value: String(index), label: section.title || String(index + 1) }] : [])),
  ];
  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      <Select
        items={options}
        value={value === undefined ? "all" : String(value)}
        onValueChange={(next) => {
          if (typeof next !== "string") return;
          onChange(next === "all" ? undefined : Number(next));
        }}
      >
        <Select.Trigger className="max-w-72">
          <Select.Value />
        </Select.Trigger>
        <Select.Content>
          {options.map((option) => (
            <Select.Item key={option.value} value={option.value}>
              {option.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select>
    </label>
  );
}
