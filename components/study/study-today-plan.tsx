import { useCallback, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button } from "@/components/panelui/button";
import { Card } from "@/components/panelui/card";
import { studyHref } from "@/lib/study/links";
import { studyReadingProgress } from "@/lib/study/reading-progress";
import type { TodayPlan, TodayStep } from "@/lib/study/today-plan";
import { cn } from "@/lib/utils";

const storageKey = (vaultId: string) => `better-vault.study.today-skipped.${vaultId}`;

/** The ids of the steps hidden "until tomorrow": kept per vault and per day, in this browser only. */
export function useSkippedToday(vaultId: string, day: string) {
  const [skipped, setSkipped] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(vaultId)) ?? "null") as {
        day?: unknown;
        ids?: unknown;
      } | null;
      if (saved?.day === day && Array.isArray(saved.ids))
        return saved.ids.filter((id): id is string => typeof id === "string");
    } catch {
      // Storage can be blocked or hold something else; nothing is hidden then.
    }
    return [];
  });
  const update = useCallback(
    (change: (ids: string[]) => string[]) =>
      setSkipped((current) => {
        const ids = change(current);
        try {
          localStorage.setItem(storageKey(vaultId), JSON.stringify({ day, ids }));
        } catch {
          // The choice still holds for this visit.
        }
        return ids;
      }),
    [vaultId, day],
  );
  return {
    skipped,
    skip: (id: string) => update((ids) => (ids.includes(id) ? ids : [...ids, id])),
    undo: () => update((ids) => ids.slice(0, -1)),
  };
}

type Words = {
  rule: string;
  title: string;
  what: string;
  reason: string;
  label: string;
  detail: string;
};

function describe(t: TFunction<"home">, step: TodayStep, percent: Intl.NumberFormat): Words {
  const k = (key: string, options?: Record<string, unknown>) =>
    String(t(`study.todayPlan.${key}` as never, options as never));
  switch (step.kind) {
    case "resume-practice": {
      const title = step.session.title;
      const detail = k("steps.resumePractice.detail", {
        answered: step.answered,
        total: step.total,
      });
      return {
        rule: k("rules.resume"),
        title: k("steps.resumePractice.title", { title }),
        what: k("steps.resumePractice.what"),
        reason: k("steps.resumePractice.reason"),
        label: k("steps.resumePractice.label"),
        detail,
      };
    }
    case "resume-review":
      return {
        rule: k("rules.resume"),
        title: k("steps.resumeReview.title"),
        what: k("steps.resumeReview.what"),
        reason: k("steps.resumeReview.reason"),
        label: k("steps.resumeReview.label"),
        detail: k("steps.resumeReview.detail", { count: step.due }),
      };
    case "practise": {
      const key = step.mode === "teach" ? "teach" : "questions";
      const title = step.book.title;
      return {
        rule: k("rules.practise"),
        title: k(`steps.${key}.title`, { title }),
        what: k(`steps.${key}.what`),
        reason: k(`steps.${key}.reason`),
        label: k(`steps.${key}.label`, { title }),
        detail: k(`steps.${key}.detail`),
      };
    }
    case "cards":
      return {
        rule: k("rules.cards"),
        title: k("steps.cards.title", { count: step.due }),
        what: k("steps.cards.what"),
        reason: k("steps.cards.reason"),
        label: k("steps.cards.label", { count: step.due }),
        detail: k("steps.cards.detail", { count: step.due }),
      };
    case "read": {
      const progress = studyReadingProgress(step.book);
      const shown = progress < 1 ? Math.min(0.99, progress) : 1;
      const chapter =
        step.book.sections.length > 1 ? step.book.sections[step.book.section]?.title : undefined;
      return {
        rule: k("rules.read"),
        title: k("steps.read.title", { title: step.book.title }),
        what: chapter ?? step.book.title,
        reason: k("steps.read.reason"),
        label: k("steps.read.label"),
        detail: k("steps.read.detail", { percent: percent.format(shown) }),
      };
    }
    case "new":
      return {
        rule: k("rules.new"),
        title: k("steps.new.title", { title: step.book.title }),
        what: k("steps.new.what"),
        reason: k("steps.new.reason"),
        label: k("steps.new.label"),
        detail: k("steps.new.detail"),
      };
  }
}

/** Today's one next step, its reason, and the transparent list it was chosen from. */
export function TodayPlanCard({
  plan,
  vaultId,
  start,
  skip,
  undo,
  add,
  percent,
}: {
  plan: TodayPlan;
  vaultId: string;
  start: (step: TodayStep) => void;
  skip: (step: TodayStep) => void;
  undo: () => void;
  add: () => void;
  percent: Intl.NumberFormat;
}) {
  const { t } = useTranslation("home");
  const [choosing, setChoosing] = useState(false);
  const { state, next, then, hidden, steps } = plan;
  const hiddenNote = hidden.length ? (
    <p role="status" className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
      {hidden.length === 1
        ? t("study.todayPlan.hiddenOne", { title: describe(t, hidden[0], percent).title })
        : t("study.todayPlan.hiddenMany", { count: hidden.length })}
      <Button variant="link" size="sm" className="h-auto px-0" onClick={undo}>
        {t("study.todayPlan.undo")}
      </Button>
    </p>
  ) : null;

  if (state === "first-time") {
    return (
      <Card as="section" aria-label={t("study.todayPlan.nextStep")} className="shadow-none">
        <Card.Content className="flex flex-col items-start gap-3">
          <p className="text-xs font-medium text-muted-foreground">
            {t("study.todayPlan.nextStep")}
          </p>
          <h3 className="font-serif text-2xl font-medium">{t("study.todayPlan.firstTitle")}</h3>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t("study.todayPlan.firstDescription")}
          </p>
          <Button shape="pill" onClick={add}>
            {t("study.todayPlan.firstAction")}
          </Button>
        </Card.Content>
      </Card>
    );
  }

  const described = next ? describe(t, next, percent) : undefined;
  // "How Today chose this": every rule from the top, with what fits each, or nothing.
  const hasResume = steps.some(
    ({ kind }) => kind === "resume-practice" || kind === "resume-review",
  );
  const chooser = choosing ? (
    <div className="space-y-3 border-t pt-4">
      <div className="space-y-0.5">
        <h4 className="text-sm font-semibold">
          {t(state === "done" ? "study.todayPlan.moreTitle" : "study.todayPlan.chooseTitle")}
        </h4>
        <p className="text-xs text-muted-foreground">
          {t(state === "done" ? "study.todayPlan.moreNote" : "study.todayPlan.chooseNote")}
        </p>
      </div>
      <ol className="space-y-1">
        {state !== "done" && !hasResume ? (
          <li className="grid min-h-12 grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-2.5 px-2 py-1.5">
            <span aria-hidden="true" className="text-xs text-muted-foreground tabular-nums">
              1
            </span>
            <span className="min-w-0 text-sm text-muted-foreground">
              <span className="text-xs">{t("study.todayPlan.rules.resume")}</span>
              <br />
              {t("study.todayPlan.noneRight")} · {t("study.todayPlan.noneSessions")}
            </span>
          </li>
        ) : null}
        {steps.map((step, index) => {
          const words = describe(t, step, percent);
          const current = step.id === next?.id;
          return (
            <li
              key={step.id}
              aria-current={current ? "step" : undefined}
              className={cn(
                "grid min-h-12 grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-lg px-2 py-1.5",
                current && "bg-muted ring-1 ring-border",
              )}
            >
              <span aria-hidden="true" className="text-xs text-muted-foreground tabular-nums">
                {index + (state !== "done" && !hasResume ? 2 : 1)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs text-muted-foreground" dir="auto">
                  {words.rule}
                  {current ? ` · ${t("study.todayPlan.nextTag")}` : ""}
                </span>
                <span className="block truncate text-sm" dir="auto">
                  {words.title} · {words.detail}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("study.todayPlan.startAria", { title: words.title })}
                onClick={() => start(step)}
              >
                {t("study.todayPlan.start")}
              </Button>
            </li>
          );
        })}
      </ol>
      <Link
        to={studyHref("practice", { vault: vaultId })}
        className="inline-block text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        {t("study.todayPlan.openPractice")}
      </Link>
    </div>
  ) : null;
  const chooseButton =
    state === "nothing" ? null : (
      <Button
        variant="ghost"
        shape="pill"
        aria-expanded={choosing}
        onClick={() => setChoosing((value) => !value)}
      >
        {t(choosing ? "study.todayPlan.hideChoices" : "study.todayPlan.chooseElse")}
      </Button>
    );

  return (
    <Card as="section" aria-label={t("study.todayPlan.nextStep")} className="shadow-none">
      <Card.Content className="flex flex-col gap-4">
        {state === "step" && next && described ? (
          <>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {t("study.todayPlan.nextStep")}
              </p>
              <h3
                className="font-serif text-2xl leading-tight font-medium wrap-break-word sm:text-3xl"
                dir="auto"
              >
                {described.title}
              </h3>
              <p className="text-sm text-muted-foreground" dir="auto">
                {described.what}
              </p>
              <p className="text-sm" dir="auto">
                {described.reason}.{" "}
                <span className="text-muted-foreground">{described.detail}</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button shape="pill" onClick={() => start(next)}>
                {t("study.todayPlan.start")}
              </Button>
              <Button variant="outline" shape="pill" onClick={() => skip(next)}>
                {t("study.todayPlan.notToday")}
              </Button>
              {chooseButton}
            </div>
            {hiddenNote}
            {!choosing && then.length ? (
              <div className="space-y-1.5 border-t pt-4">
                <h4 className="text-xs font-medium text-muted-foreground">
                  {t("study.todayPlan.then")}
                </h4>
                <ol className="space-y-1">
                  {then.map((step, index) => {
                    const words = describe(t, step, percent);
                    return (
                      <li key={step.id} className="flex min-w-0 items-center gap-2.5 text-sm">
                        <span
                          aria-hidden="true"
                          className="w-5 text-xs text-muted-foreground tabular-nums"
                        >
                          {index + 1}
                        </span>
                        <span className="truncate" dir="auto">
                          {t("study.todayPlan.thenDetail", {
                            label: words.label,
                            detail: words.detail,
                          })}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {t("study.todayPlan.nextStep")}
              </p>
              <h3 className="font-serif text-2xl font-medium">
                {t(state === "done" ? "study.todayPlan.doneTitle" : "study.todayPlan.nothingTitle")}
              </h3>
              <p className="max-w-prose text-sm text-muted-foreground">
                {t(
                  state === "done"
                    ? "study.todayPlan.doneDescription"
                    : "study.todayPlan.nothingDescription",
                )}
              </p>
            </div>
            {hiddenNote}
            {steps.length ? <div>{chooseButton}</div> : null}
          </>
        )}
        {chooser}
      </Card.Content>
    </Card>
  );
}
