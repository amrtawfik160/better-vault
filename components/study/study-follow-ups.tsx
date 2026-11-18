import { useId } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/panelui/button";
import { Card } from "@/components/panelui/card";
import { updateStudyReport } from "@/lib/db/study";
import type { StudyThread } from "@/lib/study/records";
import { plannedStudySteps } from "@/lib/study/reports";
import { StudyOriginLink } from "./study-origin-link";

export function StudyFollowUps({ threads, today }: { threads: StudyThread[]; today: number }) {
  const { t } = useTranslation("home");
  const listId = useId();
  const steps = plannedStudySteps(threads);
  const pending = steps.filter(({ completedAt }) => completedAt === undefined);
  const completed = steps.filter(
    ({ completedAt }) => completedAt !== undefined && completedAt >= today,
  );
  if (!pending.length && !completed.length) return null;

  function items(entries: typeof steps, action: "complete" | "reopen") {
    return (
      <ul className="divide-y">
        {entries.map(({ text, index, threadId, reportId, title }, position) => {
          const id = `${listId}-${action}-${position}`;
          return (
            <li
              key={JSON.stringify([threadId, reportId, index])}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p id={id} className="wrap-break-word" dir="auto">
                  {text}
                </p>
                <p className="truncate text-xs text-muted-foreground" dir="auto">
                  {title}
                </p>
              </div>
              <StudyOriginLink origin={{ kind: "report", threadId, reportId }} />
              <Button
                size="sm"
                variant="outline"
                aria-describedby={id}
                onClick={() => {
                  void updateStudyReport(threadId, { kind: "step", reportId, index, action })
                    .then((saved) => {
                      if (!saved) toast.error(t("study.followUps.unavailable"));
                    })
                    .catch((error: Error) => toast.error(error.message));
                }}
              >
                {t(`study.followUps.${action}`)}
              </Button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Card size="sm">
      <Card.Header>
        <Card.Title>{t("study.followUps.title")}</Card.Title>
      </Card.Header>
      <Card.Content className="space-y-2">
        {pending.length ? items(pending, "complete") : null}
        {completed.length ? (
          <details className="border-t pt-2 first:border-t-0 first:pt-0">
            <summary className="cursor-pointer text-sm text-muted-foreground">
              {t("study.followUps.completedToday", { count: completed.length })}
            </summary>
            {items(completed, "reopen")}
          </details>
        ) : null}
      </Card.Content>
    </Card>
  );
}
