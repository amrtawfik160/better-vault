import { ArrowLeft01Icon, QuillWrite01Icon, TeachingIcon } from "@hugeicons/core-free-icons";
import { AIModelPicker } from "@/components/ai/ai-model-picker";
import { useCallback, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { DirectionalText } from "@/components/common/directional-text";
import { Icon, type IconSvgElement } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { usePracticeSessions, type PracticeMode } from "@/lib/db/writing-practice";
import type { StudyPractice } from "@/lib/study/records";
import { analysedTeachRounds, teachCoverage } from "@/lib/study/teach";
import { practiceSessionStats } from "@/lib/study/writing-practice";
import { cn } from "@/lib/utils";
import { PracticeQuestionsSession } from "./practice-session";
import { TeachSession } from "./teach-session";

/** The search parameter that holds the open written-practice session. */
export const writingPracticeParam = "writing";

export const modeIcons: Record<PracticeMode, IconSvgElement> = { questions: QuillWrite01Icon, teach: TeachingIcon };
export const sessionMode = (session: StudyPractice): PracticeMode => session.mode ?? "questions";

/** One line about how a session went: average score and answers, or coverage per round. */
export function usePracticeSessionSummary() {
  const { t } = useTranslation("home");
  return (session: StudyPractice) => {
    if (sessionMode(session) === "teach") {
      const rounds = analysedTeachRounds(session);
      const last = rounds.at(-1);
      return last
        ? t("study.writingPractice.home.teachSummary", { count: rounds.length, percent: Math.round(teachCoverage(last.analysis.ideas) * 100) })
        : t("study.writingPractice.home.teachNotStarted");
    }
    const stats = practiceSessionStats(session);
    return [
      t("study.writingPractice.answeredCount", { count: stats.answered, total: stats.total }),
      stats.averageScore === undefined ? "" : t("study.writingPractice.home.average", { score: Math.round(stats.averageScore * 10) / 10 }),
    ].filter(Boolean).join(" · ");
  };
}

/** A compact link to a session, for Today or other lists. */
export function PracticeSessionLink({ session, className }: { session: StudyPractice; className?: string }) {
  const { t } = useTranslation("home");
  const summary = usePracticeSessionSummary();
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.set("view", "study");
  next.set("tab", "practice");
  next.set(writingPracticeParam, session.id);
  return (
    <Link to={{ search: `?${next}` }} className={cn("block min-w-0 rounded-xl border p-3 text-sm hover:bg-muted/50", className)}>
      <span className="flex items-center gap-2 font-medium">
        <Icon icon={modeIcons[sessionMode(session)]} size={16} className="shrink-0 text-muted-foreground" />
        <DirectionalText as="span" text={session.title} className="truncate" />
      </span>
      <span className="mt-0.5 block text-xs text-muted-foreground">
        {t(`study.writingPractice.audiences.${session.audience}.label`)} · {summary(session)}
      </span>
    </Link>
  );
}

/** The written sessions of a vault, and the one open in the address (`?writing=<id>`). */
export function useWritingPractice(vaultId: string) {
  const sessions = usePracticeSessions(vaultId);
  const [params, setParams] = useSearchParams();
  const openId = params.get(writingPracticeParam);
  const session = openId ? sessions?.find(({ id }) => id === openId) : undefined;
  const open = useCallback(
    (id: string | undefined) =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        if (id) next.set(writingPracticeParam, id);
        else next.delete(writingPracticeParam);
        return next;
      }),
    [setParams],
  );
  return { sessions, session, openId, open, missing: Boolean(openId && sessions && !session) };
}

/**
 * One written session: answer questions made from what the learner studied,
 * or explain it back in rounds, with feedback judged for the audience chosen.
 */
export function WritingPracticeSession({
  session,
  setup,
  open,
}: {
  session: StudyPractice;
  /** Opens Settings → AI providers. Without it, the page says where to set up a model. */
  setup?: () => void;
  /** Opens another session (a retry), or none to go back to the Practice page. */
  open: (id: string | undefined) => void;
}) {
  const { t } = useTranslation("home");
  const top = useRef<HTMLElement>(null);
  useEffect(() => {
    // Only the page's own scroll area moves: scrollIntoView would also shift the tab's fixed frame.
    const section = top.current;
    const viewport = section?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (section && viewport) {
      const offset = section.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      if (offset < 0) viewport.scrollTo({ top: viewport.scrollTop + offset - 16 });
    }
  }, [session.id]);
  return (
    <section
      ref={top}
      aria-label={session.title}
      // Questions keep the Practice page's measure; a teach-back round has a side column for the last round.
      className={cn("mx-auto w-full space-y-4", sessionMode(session) === "teach" ? "max-w-5xl" : "max-w-3xl")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => open(undefined)}>
          <Icon icon={ArrowLeft01Icon} size={16} className="rtl:rotate-180" />
          {t("study.practicePage.back")}
        </Button>
        <div className="min-w-0 flex-1">
          <DirectionalText as="p" text={session.title} className="truncate font-semibold" />
          <p className="text-xs text-muted-foreground">
            {t(`study.writingPractice.modes.${sessionMode(session)}.short`)} · {t(`study.writingPractice.audiences.${session.audience}.label`)}
            {/* The title usually names the material already. */}
            {session.material.label && !session.title.includes(session.material.label) ? ` · ${session.material.label}` : ""}
          </p>
        </div>
        {/* Questions, feedback and explaining it back remember their own model. */}
        <AIModelPicker use="writing" appearance="outline" side="bottom" align="end" />
      </div>
      {session.scenario ? (
        <p className="rounded-xl bg-muted/50 p-3 text-sm">
          <span className="font-medium">{t("study.writingPractice.scenarioLabel")}</span> <span dir="auto">{session.scenario}</span>
        </p>
      ) : null}
      {sessionMode(session) === "teach" ? (
        <TeachSession key={session.id} session={session} setup={setup} />
      ) : (
        <PracticeQuestionsSession key={session.id} session={session} setup={setup} open={open} />
      )}
    </section>
  );
}
