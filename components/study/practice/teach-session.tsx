import { ArrowLeft01Icon, Cards01Icon, CheckmarkCircle02Icon, Note01Icon, RepeatIcon } from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DirectionalText } from "@/components/common/directional-text";
import { Icon } from "@/components/icon";
import { Alert } from "@/components/panelui/alert";
import { Button } from "@/components/panelui/button";
import { studyId } from "@/lib/db/study";
import { saveTeachAttempt, saveTeachGapCards, saveTeachRound, savePracticeNote } from "@/lib/db/writing-practice";
import type { StudyPractice, StudyTeachAnalysis, StudyTeachIdea, StudyTeachIdeaStatus, StudyTeachRound } from "@/lib/study/records";
import {
  analysedTeachRounds,
  compareTeachRounds,
  teachCoverage,
  teachGaps,
  teachPrevious,
  teachStatusCounts,
} from "@/lib/study/teach";
import { practiceRequestPassages } from "@/lib/study/writing-practice";
import { analyseTeachBack } from "@/lib/study/writing-practice-client";
import { clearPracticeAnswerDraft, readPracticeAnswerDraft, savePracticeAnswerDraft } from "@/lib/study/writing-practice-drafts";
import { cn } from "@/lib/utils";
import { PracticeQuestion } from "./practice-question";
import { AnswerEditor, CitationLinks, LanguageNotes, PracticeError, ScoreMeter, Section, VocabularyChips } from "./practice-parts";

const statusStyle: Record<StudyTeachIdeaStatus, { card: string; dot: string; text: string }> = {
  explained: { card: "border-success/40 bg-success/10", dot: "bg-success", text: "text-success" },
  partial: { card: "border-warning/40 bg-warning/10", dot: "bg-warning", text: "text-warning" },
  wrong: { card: "border-destructive/40 bg-destructive/10", dot: "bg-destructive", text: "text-destructive" },
  missing: { card: "border-border bg-muted/50", dot: "bg-muted-foreground", text: "text-muted-foreground" },
};
const percent = (value: number) => Math.round(value * 100);

function IdeaMap({ session, ideas }: { session: StudyPractice; ideas: readonly StudyTeachIdea[] }) {
  const { t } = useTranslation("home");
  return (
    <ul className="grid gap-2 sm:grid-cols-2" aria-label={t("study.writingPractice.teach.ideaMap")}>
      {ideas.map((idea, index) => {
        const style = statusStyle[idea.status];
        return (
          <li key={index}>
            <details className={cn("group rounded-xl border p-3 text-sm", style.card)}>
              <summary className="flex cursor-pointer list-none items-start gap-2">
                <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", style.dot)} />
                <span className="min-w-0 flex-1">
                  <DirectionalText as="span" text={idea.title} className="font-medium" />
                  <span className={cn("block text-xs", style.text)}>{t(`study.writingPractice.teach.status.${idea.status}`)}</span>
                </span>
              </summary>
              <div className="mt-2 space-y-2 ps-4">
                {idea.note ? <DirectionalText text={idea.note} /> : null}
                {idea.quote ? (
                  <blockquote className="border-s-2 ps-3 text-muted-foreground italic" dir="auto">
                    {idea.quote}
                  </blockquote>
                ) : null}
                <CitationLinks session={session} citations={idea.citations} />
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function CoverageLine({ analysis }: { analysis: StudyTeachAnalysis }) {
  const { t } = useTranslation("home");
  const counts = teachStatusCounts(analysis.ideas);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <p className="text-sm">
          {t("study.writingPractice.teach.coverage", { explained: counts.explained, total: analysis.ideas.length, percent: percent(teachCoverage(analysis.ideas)) })}
        </p>
        <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
          {(["explained", "partial", "wrong"] as const).map((status) => (
            <div key={status} className={statusStyle[status].dot} style={{ width: `${(counts[status] / Math.max(1, analysis.ideas.length)) * 100}%` }} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("study.writingPractice.teach.counts", counts)}
        </p>
      </div>
      <ScoreMeter label={t("study.writingPractice.teach.accuracy")} value={analysis.accuracy} />
    </div>
  );
}

function Comparison({ previous, current }: { previous: StudyTeachAnalysis; current: StudyTeachAnalysis }) {
  const { t } = useTranslation("home");
  const change = compareTeachRounds(previous, current);
  return (
    <div className="space-y-2 rounded-xl bg-info/10 p-3 text-sm">
      <p className="font-medium text-info">
        {t("study.writingPractice.teach.coverageChange", { before: percent(change.coverageBefore), after: percent(change.coverageAfter) })}
      </p>
      {current.progress ? <DirectionalText text={current.progress} /> : null}
      {change.improved.length ? (
        <p>
          <span className="font-medium">{t("study.writingPractice.teach.improved")}</span> {change.improved.join(" · ")}
        </p>
      ) : null}
      {change.slipped.length ? (
        <p>
          <span className="font-medium">{t("study.writingPractice.teach.slipped")}</span> {change.slipped.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

function AnalysisView({
  session,
  round,
  number,
  previous,
  setup,
}: {
  session: StudyPractice;
  round: StudyTeachRound & { analysis: StudyTeachAnalysis };
  number: number;
  previous?: StudyTeachAnalysis;
  setup?: () => void;
}) {
  const { t } = useTranslation("home");
  const { analysis } = round;
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="text-lg font-semibold">{t("study.writingPractice.teach.roundTitle", { number })}</h3>
        {analysis.summary ? <DirectionalText text={analysis.summary} className="text-sm" /> : null}
        <CoverageLine analysis={analysis} />
        {previous ? <Comparison previous={previous} current={analysis} /> : null}
      </div>

      <Section title={t("study.writingPractice.teach.ideasTitle")}>
        <p className="text-xs text-muted-foreground">{t("study.writingPractice.teach.ideasHint")}</p>
        <IdeaMap session={session} ideas={analysis.ideas} />
      </Section>

      {analysis.misconceptions.length ? (
        <Section title={t("study.writingPractice.teach.misconceptions")}>
          <ul className="space-y-2 text-sm">
            {analysis.misconceptions.map((item, index) => (
              <li key={index} className="space-y-1 rounded-xl border border-destructive/30 p-3">
                <p>
                  <span className="font-medium">{t("study.writingPractice.teach.youSaid")}</span>{" "}
                  <span dir="auto">{item.said}</span>
                </p>
                <p>
                  <span className="font-medium">{t("study.writingPractice.teach.sourceSays")}</span>{" "}
                  <span dir="auto">{item.source}</span>
                  <CitationLinks session={session} citations={item.citations} />
                </p>
                {item.why ? <p className="text-muted-foreground">{item.why}</p> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {analysis.teaching.length ? (
        <Section title={t(`study.writingPractice.teach.teachingTitle.${session.audience}`)}>
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {analysis.teaching.map((advice, index) => (
              <li key={index}>
                <DirectionalText as="span" text={advice} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <LanguageNotes items={analysis.language} />
      <VocabularyChips session={session} items={analysis.vocabulary} />

      {round.questions.length ? (
        <Section title={t("study.writingPractice.teach.questionsTitle")}>
          <p className="text-xs text-muted-foreground">{t("study.writingPractice.teach.questionsHint")}</p>
          <ol className="space-y-4">
            {round.questions.map((question) => (
              <li key={question.id} className="rounded-2xl border p-4">
                <PracticeQuestion
                  compact
                  session={session}
                  question={question}
                  setup={setup}
                  save={(attempt) => saveTeachAttempt(session.id, round.id, question.id, attempt)}
                />
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      <details className="rounded-xl border p-3 text-sm">
        <summary className="cursor-pointer font-medium">{t("study.writingPractice.teach.yourExplanation")}</summary>
        <DirectionalText multiline text={round.explanation} className="mt-2 whitespace-pre-wrap text-muted-foreground" />
      </details>
    </div>
  );
}

/** The previous round beside the editor: which ideas came across, and the teaching advice. */
function PreviousRound({ analysis }: { analysis: StudyTeachAnalysis }) {
  const { t } = useTranslation("home");
  return (
    <details open className="rounded-xl border p-3 text-sm lg:sticky lg:top-4">
      <summary className="cursor-pointer font-medium">{t("study.writingPractice.teach.lastRound")}</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          {t("study.writingPractice.teach.coverageShort", { percent: percent(teachCoverage(analysis.ideas)) })}
        </p>
        <ul className="space-y-1.5">
          {analysis.ideas.map((idea, index) => (
            <li key={index} className="flex gap-2">
              <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", statusStyle[idea.status].dot)} />
              <span className="min-w-0">
                <DirectionalText as="span" text={idea.title} />
                <span className={cn("ms-1 text-xs", statusStyle[idea.status].text)}>
                  {t(`study.writingPractice.teach.status.${idea.status}`)}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {analysis.teaching.length ? (
          <ul className="list-disc space-y-1 border-t pt-3 ps-5 text-muted-foreground">
            {analysis.teaching.map((advice, index) => (
              <li key={index}>{advice}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

function ExplainEditor({
  session,
  number,
  pendingRound,
  previous,
  lastExplanation,
  setup,
  cancel,
  done,
}: {
  session: StudyPractice;
  number: number;
  /** A round saved before its analysis came back (the analysis failed or was interrupted). */
  pendingRound?: StudyTeachRound;
  previous?: StudyTeachAnalysis;
  lastExplanation?: string;
  setup?: () => void;
  cancel?: () => void;
  done: () => void;
}) {
  const { t } = useTranslation("home");
  const key = `teach:${number}`;
  const [text, setText] = useState(() => readPracticeAnswerDraft(session.id, key)?.text ?? pendingRound?.explanation ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  function change(next: string) {
    setText(next);
    savePracticeAnswerDraft(session.id, key, { text: next });
  }

  async function submit() {
    const explanation = text.trim();
    if (!explanation || pending) return;
    const id = pendingRound?.id ?? studyId();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(undefined);
    try {
      await saveTeachRound(session.id, { id, explanation });
      const result = await analyseTeachBack(
        {
          audience: session.audience,
          scenario: session.scenario,
          passages: practiceRequestPassages(session),
          explanation,
          round: number,
          previous: teachPrevious(previous),
        },
        controller.signal,
      );
      await saveTeachRound(session.id, { id, explanation, analysis: result.analysis, probing: result.questions });
      clearPracticeAnswerDraft(session.id, key);
      done();
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure);
    } finally {
      setPending(false);
      request.current = null;
    }
  }

  const editor = (
    <div className="min-w-0 space-y-3">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">
          {number > 1 ? t("study.writingPractice.teach.explainAgainTitle", { number }) : t("study.writingPractice.teach.explainTitle")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t(number > 1 ? "study.writingPractice.teach.explainAgainHint" : "study.writingPractice.teach.explainHint")}
        </p>
      </div>
      {session.material.sampled ? (
        <Alert tone="info" variant="plain">
          <Alert.Description>{t("study.writingPractice.teach.sampled")}</Alert.Description>
        </Alert>
      ) : null}
      <AnswerEditor
        label={t("study.writingPractice.teach.explainLabel")}
        value={text}
        onChange={change}
        onSubmit={() => void submit()}
        placeholder={t("study.writingPractice.teach.explainPlaceholder")}
        minRows={14}
        disabled={pending}
      >
        {lastExplanation && !text.trim() ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => change(lastExplanation)}>
            {t("study.writingPractice.teach.startFromLast")}
          </Button>
        ) : null}
        {cancel ? (
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={cancel}>
            {t("study.writingPractice.cancel")}
          </Button>
        ) : null}
      </AnswerEditor>
      {pending ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t("study.writingPractice.teach.analysing")}
        </p>
      ) : null}
      {error ? <PracticeError error={error} retry={() => void submit()} setup={setup} /> : null}
    </div>
  );
  if (!previous) return editor;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {editor}
      <aside>
        <PreviousRound analysis={previous} />
      </aside>
    </div>
  );
}

function TeachSummary({ session, back, again }: { session: StudyPractice; back: () => void; again: () => void }) {
  const { t, i18n } = useTranslation("home");
  const rounds = analysedTeachRounds(session);
  const gaps = teachGaps(session);
  const latest = rounds.at(-1);
  const [savingCards, setSavingCards] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });

  async function makeCards() {
    setSavingCards(true);
    try {
      const cards = await saveTeachGapCards(
        session,
        gaps.map((idea) => ({
          idea,
          front: t("study.writingPractice.teach.gapFront", { title: idea.title }),
          back: [idea.quote, idea.note].filter(Boolean).join("\n\n") || idea.title,
        })),
      );
      toast.success(t("study.writingPractice.cardsSaved", { count: cards.length }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingCards(false);
    }
  }

  async function saveNote() {
    if (!latest) return;
    setSavingNote(true);
    const body = [
      `## ${t("study.writingPractice.teach.yourExplanation")}\n\n${latest.explanation}`,
      gaps.length
        ? `## ${t("study.writingPractice.teach.gapsTitle")}\n\n${gaps.map((idea) => `- **${idea.title}** (${t(`study.writingPractice.teach.status.${idea.status}`)})${idea.note ? `: ${idea.note}` : ""}`).join("\n")}`
        : "",
    ].filter(Boolean).join("\n\n");
    try {
      await savePracticeNote(session, { title: session.title, body, citations: gaps[0]?.citations });
      toast.success(t("study.writingPractice.noteSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">{t("study.writingPractice.teach.summaryTitle")}</h3>
      <Section title={t("study.writingPractice.teach.roundsTitle")}>
        <ol className="divide-y rounded-xl border text-sm">
          {rounds.map((round, index) => (
            <li key={round.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3">
              <span className="font-medium">{t("study.writingPractice.teach.roundTitle", { number: index + 1 })}</span>
              <span className="text-muted-foreground">{date.format(round.at)}</span>
              <span className="flex-1" />
              <span>{t("study.writingPractice.teach.coverageShort", { percent: percent(teachCoverage(round.analysis.ideas)) })}</span>
              <span className="text-muted-foreground">{t("study.writingPractice.teach.accuracyShort", { score: round.analysis.accuracy })}</span>
            </li>
          ))}
        </ol>
      </Section>
      <Section title={t("study.writingPractice.teach.gapsTitle")}>
        {gaps.length ? (
          <ul className="space-y-1.5 text-sm">
            {gaps.map((idea, index) => (
              <li key={index} className="flex gap-2">
                <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", statusStyle[idea.status].dot)} />
                <span>
                  <DirectionalText as="span" text={idea.title} className="font-medium" />
                  <span className={cn("ms-1 text-xs", statusStyle[idea.status].text)}>{t(`study.writingPractice.teach.status.${idea.status}`)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-sm text-success">
            <Icon icon={CheckmarkCircle02Icon} size={16} />
            {t("study.writingPractice.teach.noGaps")}
          </p>
        )}
      </Section>
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button variant="ghost" size="sm" onClick={back}>
          <Icon icon={ArrowLeft01Icon} size={16} className="rtl:rotate-180" />
          {t("study.writingPractice.teach.backToRound")}
        </Button>
        <span className="flex-1" />
        {gaps.length ? (
          <Button variant="outline" size="sm" loading={savingCards} onClick={() => void makeCards()}>
            <Icon icon={Cards01Icon} size={16} />
            {t("study.writingPractice.teach.gapCards", { count: gaps.length })}
          </Button>
        ) : null}
        <Button variant="outline" size="sm" loading={savingNote} disabled={!latest} onClick={() => void saveNote()}>
          <Icon icon={Note01Icon} size={16} />
          {t("study.writingPractice.teach.saveExplanation")}
        </Button>
        <Button size="sm" onClick={again}>
          <Icon icon={RepeatIcon} size={16} />
          {t("study.writingPractice.teach.explainAgain")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Explain what you learned (written teach-back), in rounds: the learner
 * explains the material, the analysis maps its key ideas by how well they
 * came across and asks probing questions, then the learner explains again
 * until the gaps close.
 */
export function TeachSession({ session, setup }: { session: StudyPractice; setup?: () => void }) {
  const { t } = useTranslation("home");
  const rounds = session.rounds ?? [];
  const analysed = analysedTeachRounds(session);
  const current = rounds.at(-1);
  const latest = analysed.at(-1);
  const [view, setView] = useState<"round" | "again" | "summary">("round");

  if (view === "summary" && latest) return <TeachSummary session={session} back={() => setView("round")} again={() => setView("again")} />;

  const writing = view === "again" || !current || !current.analysis;
  if (writing) {
    const pendingRound = current && !current.analysis ? current : undefined;
    return (
      <ExplainEditor
        key={rounds.length + (pendingRound ? 0 : 1)}
        session={session}
        number={pendingRound ? rounds.length : rounds.length + 1}
        pendingRound={pendingRound}
        previous={latest?.analysis}
        lastExplanation={latest?.explanation}
        setup={setup}
        cancel={latest ? () => setView("round") : undefined}
        done={() => setView("round")}
      />
    );
  }

  const shown = latest ?? (current as StudyTeachRound & { analysis: StudyTeachAnalysis });
  const index = analysed.indexOf(shown);
  return (
    <div className="space-y-6">
      <AnalysisView
        session={session}
        round={shown}
        number={index + 1}
        previous={index > 0 ? analysed[index - 1].analysis : undefined}
        setup={setup}
      />
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => setView("summary")}>
          {t("study.writingPractice.teach.finish")}
        </Button>
        <Button size="sm" onClick={() => setView("again")}>
          <Icon icon={RepeatIcon} size={16} />
          {t("study.writingPractice.teach.explainAgain")}
        </Button>
      </div>
    </div>
  );
}
