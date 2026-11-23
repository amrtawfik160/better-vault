import { Copy01Icon, Mic01Icon, StopIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DirectionalText } from "@/components/common/directional-text";
import { Icon } from "@/components/icon";
import { Alert } from "@/components/panelui/alert";
import { Button } from "@/components/panelui/button";
import { Textarea } from "@/components/panelui/textarea";
import { useSettings } from "@/lib/db/settings";
import { saveStudyWord } from "@/lib/db/study";
import { practiceQuestionOrigin } from "@/lib/db/writing-practice";
import type { StudyPractice, StudyPracticeFeedback, StudyPracticeVerdict } from "@/lib/study/records";
import { translationLanguageLabel } from "@/lib/study/translation-language";
import { practiceCitationPassage, practiceWordCount } from "@/lib/study/writing-practice";
import { PracticeModelMissing } from "@/lib/study/writing-practice-client";
import { cn } from "@/lib/utils";
import { StudyOriginLink } from "../study-origin-link";
import { useDictation } from "./use-dictation";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform);

/** A generous writing space with a word count, dictation and ⌘/Ctrl+Enter to submit. */
export function AnswerEditor({
  label,
  value,
  onChange,
  onSubmit,
  placeholder,
  targetWords,
  minRows = 6,
  disabled,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  targetWords?: number;
  minRows?: number;
  disabled?: boolean;
  /** Buttons beside Submit: hints, Show me, Cancel. */
  children?: ReactNode;
}) {
  const { t } = useTranslation("home");
  const id = useId();
  const words = practiceWordCount(value);
  const dictation = useDictation(
    (text) => onChange(value.trim() ? `${value.trimEnd()} ${text}` : text),
    (message) => toast.error(message),
  );
  const dictating = dictation.state !== "idle";
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Textarea
        id={id}
        size="lg"
        minRows={minRows}
        maxRows={24}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        dir="auto"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (value.trim() && !disabled) onSubmit();
          }
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {targetWords
            ? t("study.writingPractice.wordsOfTarget", { count: words, target: targetWords })
            : t("study.writingPractice.words", { count: words })}
          {" · "}
          {t(isMac ? "study.writingPractice.submitKeyMac" : "study.writingPractice.submitKey")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {dictation.available ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || dictation.state === "opening" || dictation.state === "transcribing"}
              loading={dictation.state === "opening" || dictation.state === "transcribing"}
              aria-pressed={dictation.state === "recording"}
              onClick={dictation.toggle}
            >
              <Icon icon={dictation.state === "recording" ? StopIcon : Mic01Icon} size={16} />
              {t(
                dictation.state === "recording"
                  ? "study.writingPractice.stopDictation"
                  : dictation.state === "transcribing"
                    ? "study.writingPractice.transcribing"
                    : "study.writingPractice.dictate",
              )}
            </Button>
          ) : null}
          {children}
          <Button type="button" size="sm" disabled={disabled || dictating || !value.trim()} onClick={onSubmit}>
            {t("study.writingPractice.submit")}
          </Button>
        </div>
      </div>
    </div>
  );
}

const verdictTone: Record<StudyPracticeVerdict, string> = {
  correct: "bg-success/15 text-success",
  partial: "bg-warning/15 text-warning",
  incorrect: "bg-destructive/15 text-destructive",
};

export function VerdictBadge({ verdict }: { verdict: StudyPracticeVerdict }) {
  const { t } = useTranslation("home");
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", verdictTone[verdict])}>
      {t(`study.writingPractice.verdicts.${verdict}`)}
    </span>
  );
}

/** A 1–5 score as a small meter with its number. */
export function ScoreMeter({ label, value }: { label: string; value: number }) {
  const { t } = useTranslation("home");
  const rounded = Math.round(value * 10) / 10;
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{t("study.writingPractice.scoreOutOf", { score: rounded })}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={1}
        aria-valuemax={5}
        aria-valuenow={rounded}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", value >= 4 ? "bg-success" : value >= 3 ? "bg-warning" : "bg-destructive")}
          style={{ width: `${(value / 5) * 100}%` }}
        />
      </div>
    </div>
  );
}

export function ScoreMeters({ scores }: { scores: StudyPracticeFeedback["scores"] }) {
  const { t } = useTranslation("home");
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
      {(["accuracy", "clarity", "structure", "audience"] as const).map((key) => (
        <ScoreMeter key={key} label={t(`study.writingPractice.scores.${key}`)} value={scores[key]} />
      ))}
    </div>
  );
}

/** Links to the passages a point cites, when they have a place to open. */
export function CitationLinks({ session, citations }: { session: StudyPractice; citations?: readonly number[] }) {
  const links = (citations ?? []).flatMap((number) => {
    const passage = practiceCitationPassage(session, number);
    return passage?.origin ? [{ number, passage, origin: passage.origin }] : [];
  });
  if (!links.length) return null;
  return (
    <span className="ms-1 inline-flex flex-wrap gap-1 align-baseline">
      {links.map(({ number, passage, origin }) => (
        <StudyOriginLink key={number} origin={origin} label={`[${number}] ${passage.title}`} />
      ))}
    </span>
  );
}

export function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-2", className)}>
      <h4 className="text-sm font-semibold">{title}</h4>
      {children}
    </section>
  );
}

export function PointList({
  session,
  items,
  marker,
}: {
  session: StudyPractice;
  items: readonly { text: string; citations?: number[] }[];
  marker: string;
}) {
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2">
          <span aria-hidden className={cn("mt-2 size-1.5 shrink-0 rounded-full", marker)} />
          <span className="min-w-0">
            <DirectionalText as="span" text={item.text} />
            <CitationLinks session={session} citations={item.citations} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation("home");
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={t(copied ? "study.writingPractice.copied" : "study.writingPractice.copy")}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          },
          () => toast.error(t("study.writingPractice.copyFailed")),
        )
      }
    >
      <Icon icon={copied ? Tick02Icon : Copy01Icon} size={16} />
    </Button>
  );
}

export function LanguageNotes({ items }: { items: StudyPracticeFeedback["language"] }) {
  const { t } = useTranslation("home");
  if (!items.length) return null;
  return (
    <Section title={t("study.writingPractice.languageTitle")}>
      <ul className="space-y-2 text-sm">
        {items.map((item, index) => (
          <li key={index} className="rounded-lg border p-3">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <del className="text-destructive" dir="auto">{item.original}</del>
              <span aria-hidden className="text-muted-foreground">→</span>
              <span className="sr-only">{t("study.writingPractice.suggestion")}</span>
              <ins className="font-medium text-success no-underline" dir="auto">{item.suggestion}</ins>
            </p>
            {item.reason ? <p className="mt-1 text-xs text-muted-foreground">{item.reason}</p> : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Words the feedback suggests, each with "Save word" into Vocabulary. */
export function VocabularyChips({
  session,
  items,
  citations,
}: {
  session: StudyPractice;
  items: StudyPracticeFeedback["vocabulary"];
  citations?: readonly number[];
}) {
  const { t } = useTranslation("home");
  const settings = useSettings();
  const [saved, setSaved] = useState(new Set<string>());
  const [saving, setSaving] = useState<string>();
  if (!items.length) return null;
  const translateTo = settings?.study?.translateTo;
  const language = translateTo ? translationLanguageLabel(translateTo) : "English";
  const origin = practiceQuestionOrigin(session, { citations: citations ? [...citations] : undefined });
  return (
    <Section title={t("study.writingPractice.vocabularyTitle")}>
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((word) => (
          <li key={word.term} className="space-y-1 rounded-lg border p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium" dir="auto">
                {word.term}
                {word.translation ? (
                  <span className="ms-2 font-normal text-muted-foreground" dir="auto">
                    {word.translation}
                  </span>
                ) : null}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saved.has(word.term)}
                loading={saving === word.term}
                onClick={async () => {
                  setSaving(word.term);
                  try {
                    await saveStudyWord({
                      term: word.term,
                      translation: word.translation,
                      context: word.example,
                      language,
                      note: word.meaning,
                      vaultId: session.vaultId,
                      ...(origin ? { origin } : {}),
                    });
                    setSaved((current) => new Set(current).add(word.term));
                    toast.success(t("study.writingPractice.wordSaved"));
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : String(error));
                  } finally {
                    setSaving(undefined);
                  }
                }}
              >
                {t(saved.has(word.term) ? "study.writingPractice.wordSavedShort" : "study.writingPractice.saveWord")}
              </Button>
            </div>
            {word.meaning ? <p className="text-muted-foreground">{word.meaning}</p> : null}
            {word.example ? <p className="text-xs text-muted-foreground italic" dir="auto">{word.example}</p> : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** A failed AI call: the reason, a retry, and a way to set up a model when none is chosen. */
export function PracticeError({
  error,
  retry,
  setup,
}: {
  error: unknown;
  retry?: () => void;
  setup?: () => void;
}) {
  const { t } = useTranslation("home");
  const missing = error instanceof PracticeModelMissing;
  return (
    <Alert tone={missing ? "info" : "destructive"} variant="plain">
      <Alert.Title>{t(missing ? "study.writingPractice.modelMissingTitle" : "study.writingPractice.errorTitle")}</Alert.Title>
      <Alert.Description>
        {missing
          ? t(setup ? "study.writingPractice.modelMissingBody" : "study.writingPractice.modelMissingSettings")
          : error instanceof Error
            ? error.message
            : String(error)}
      </Alert.Description>
      <Alert.Actions>
        {retry && !missing ? (
          <Button size="sm" variant="outline" onClick={retry}>
            {t("study.writingPractice.retry")}
          </Button>
        ) : null}
        {setup ? (
          <Button size="sm" variant={missing ? "default" : "ghost"} onClick={setup}>
            {t("study.writingPractice.setUpModel")}
          </Button>
        ) : null}
      </Alert.Actions>
    </Alert>
  );
}

/** A thin bar for "question 2 of 5". */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className="h-1 overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${value * 100}%` }} />
    </div>
  );
}
