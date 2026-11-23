import { ArrowLeft01Icon, Delete02Icon, PencilEdit02Icon, QuillWrite01Icon, TeachingIcon } from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DirectionalText } from "@/components/common/directional-text";
import { Icon, type IconSvgElement } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import {
  deletePracticeSession,
  renamePracticeSession,
  usePracticeSessions,
  type PracticeMode,
} from "@/lib/db/writing-practice";
import type { StudyPractice } from "@/lib/study/records";
import { analysedTeachRounds, teachCoverage } from "@/lib/study/teach";
import { practiceSessionStats } from "@/lib/study/writing-practice";
import { cn } from "@/lib/utils";
import { PracticeQuestionsSession } from "./practice-session";
import { PracticeSetup, type PracticeMaterials } from "./practice-setup";
import { TeachSession } from "./teach-session";

/** The search parameter that holds the open written-practice session. */
export const writingPracticeParam = "writing";

const modeIcons: Record<PracticeMode, IconSvgElement> = { questions: QuillWrite01Icon, teach: TeachingIcon };
const sessionMode = (session: StudyPractice): PracticeMode => session.mode ?? "questions";

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

function SessionRow({ session, open, remove }: { session: StudyPractice; open: () => void; remove: () => void }) {
  const { t, i18n } = useTranslation("home");
  const summary = usePracticeSessionSummary();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(session.title);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(session.updatedAt);
  return (
    <li className="flex flex-wrap items-center gap-2 p-3">
      <Icon icon={modeIcons[sessionMode(session)]} size={18} className="shrink-0 text-muted-foreground" />
      {renaming ? (
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await renamePracticeSession(session.id, title);
              setRenaming(false);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : String(error));
            }
          }}
        >
          <Input size="sm" autoFocus aria-label={t("study.writingPractice.home.rename")} value={title} onChange={(event) => setTitle(event.target.value)} />
          <Button size="sm" type="submit">
            {t("study.writingPractice.home.save")}
          </Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => setRenaming(false)}>
            {t("study.writingPractice.cancel")}
          </Button>
        </form>
      ) : (
        <button type="button" onClick={open} className="min-w-0 flex-1 cursor-pointer rounded-md text-start outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
          <DirectionalText as="span" text={session.title} className="block truncate text-sm font-medium" />
          <span className="block text-xs text-muted-foreground">
            {t(`study.writingPractice.modes.${sessionMode(session)}.short`)} · {t(`study.writingPractice.audiences.${session.audience}.label`)} · {date} · {summary(session)}
          </span>
        </button>
      )}
      {!renaming ? (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("study.writingPractice.home.renameNamed", { title: session.title })}
            onClick={() => {
              setTitle(session.title);
              setRenaming(true);
            }}
          >
            <Icon icon={PencilEdit02Icon} size={16} />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t("study.writingPractice.home.deleteNamed", { title: session.title })} onClick={remove}>
            <Icon icon={Delete02Icon} size={16} />
          </Button>
        </>
      ) : null}
    </li>
  );
}

/**
 * Written practice for the Practice tab: answer questions made from what the
 * learner studied (or wrote down), or explain it back in rounds, with feedback
 * judged for the audience they are preparing for. The open session is kept in
 * the address (`?writing=<id>`).
 */
export function StudyWritingPractice({
  vaultId,
  books,
  notes,
  cards,
  highlights,
  setup,
  onActiveChange,
}: PracticeMaterials & {
  vaultId: string;
  /** Opens Settings → AI providers. Without it, the page says where to set up a model. */
  setup?: () => void;
  /** Tells the tab when a session or its setup is open, so it can hide what is around it. */
  onActiveChange?: (active: boolean) => void;
}) {
  const { t } = useTranslation("home");
  const sessions = usePracticeSessions(vaultId);
  const [params, setParams] = useSearchParams();
  const openId = params.get(writingPracticeParam);
  const session = openId ? sessions?.find(({ id }) => id === openId) : undefined;
  const [starting, setStarting] = useState<PracticeMode>();
  const [deleting, setDeleting] = useState<StudyPractice | null>(null);
  const [showAll, setShowAll] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const active = Boolean(session || starting);
  const screen = session ? `session:${session.id}` : starting ? `setup:${starting}` : "home";
  const previousScreen = useRef(screen);

  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);
  useEffect(() => {
    if (previousScreen.current !== screen) top.current?.scrollIntoView({ block: "start" });
    previousScreen.current = screen;
  }, [screen]);

  function open(id: string | undefined) {
    setStarting(undefined);
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set(writingPracticeParam, id);
      else next.delete(writingPracticeParam);
      return next;
    });
  }

  const materials = { books, notes, cards, highlights };
  const back = (
    <Button variant="ghost" size="sm" onClick={() => open(undefined)}>
      <Icon icon={ArrowLeft01Icon} size={16} className="rtl:rotate-180" />
      {t("study.writingPractice.home.back")}
    </Button>
  );

  let content;
  if (session) {
    content = (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {back}
          <div className="min-w-0 flex-1">
            <DirectionalText as="p" text={session.title} className="truncate font-semibold" />
            <p className="text-xs text-muted-foreground">
              {t(`study.writingPractice.modes.${sessionMode(session)}.short`)} · {t(`study.writingPractice.audiences.${session.audience}.label`)}
              {session.material.label ? ` · ${session.material.label}` : ""}
            </p>
          </div>
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
      </div>
    );
  } else if (starting) {
    content = (
      <PracticeSetup
        mode={starting}
        vaultId={vaultId}
        materials={materials}
        setup={setup}
        cancel={() => setStarting(undefined)}
        created={(created) => open(created.id)}
      />
    );
  } else {
    const listed = showAll ? (sessions ?? []) : (sessions ?? []).slice(0, 5);
    content = (
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="font-semibold">{t("study.writingPractice.home.title")}</h3>
          <p className="text-sm text-muted-foreground">{t("study.writingPractice.home.intro")}</p>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {(["questions", "teach"] as const).map((mode) => (
            <li key={mode}>
              <button
                type="button"
                onClick={() => setStarting(mode)}
                className={cn(
                  "flex h-full w-full cursor-pointer flex-col items-start gap-2 rounded-2xl border bg-card p-4 text-start outline-none",
                  "transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40",
                )}
              >
                <Icon icon={modeIcons[mode]} size={20} className="text-muted-foreground" />
                <span className="text-sm font-medium">{t(`study.writingPractice.modes.${mode}.title`)}</span>
                <span className="text-xs text-muted-foreground">{t(`study.writingPractice.modes.${mode}.hint`)}</span>
              </button>
            </li>
          ))}
        </ul>
        {sessions?.length ? (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">{t("study.writingPractice.home.past")}</h4>
            <ul className="divide-y rounded-2xl border">
              {listed.map((entry) => (
                <SessionRow key={entry.id} session={entry} open={() => open(entry.id)} remove={() => setDeleting(entry)} />
              ))}
            </ul>
            {sessions.length > listed.length ? (
              <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                {t("study.writingPractice.home.showAll", { count: sessions.length })}
              </Button>
            ) : null}
          </div>
        ) : null}
        {openId && sessions && !session ? (
          <p className="text-sm text-muted-foreground">{t("study.writingPractice.home.missing")}</p>
        ) : null}
      </div>
    );
  }

  return (
    <section ref={top} aria-label={t("study.writingPractice.home.title")} className="scroll-mt-4">
      {content}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title={t("study.writingPractice.home.deleteTitle")}
        body={t("study.writingPractice.home.deleteBody")}
        confirmLabel={t("study.writingPractice.home.delete")}
        onConfirm={async () => {
          if (deleting) await deletePracticeSession(deleting.id);
          if (deleting?.id === openId) open(undefined);
          setDeleting(null);
        }}
      />
    </section>
  );
}
