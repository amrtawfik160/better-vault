import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/panelui/button";
import { Card } from "@/components/panelui/card";
import { DirectionalText } from "@/components/common/directional-text";
import { startStudyFollowUp, updateStudyReport } from "@/lib/db/study";
import { studyHref } from "@/lib/study/links";
import type { StudyFollowUp, StudyThread } from "@/lib/study/records";
import { plannedStudySteps, studyFollowUpId } from "@/lib/study/reports";
import { studyReturnState } from "@/lib/study/return-links";
import { StudyOriginLink } from "./study-origin-link";

export function StudyFollowUpButton({
  target,
  vaultId,
  resume,
  description,
  disabled,
}: {
  target: Omit<StudyFollowUp, "text">;
  vaultId: string;
  resume: boolean;
  description: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation("home");
  const navigate = useNavigate();
  const { state } = useLocation();
  const request = useRef<AbortController | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => () => request.current?.abort(), []);

  async function open() {
    if (request.current) return;
    const loading = new AbortController();
    request.current = loading;
    setOpening(true);
    try {
      const id = await startStudyFollowUp(target, vaultId);
      if (loading.signal.aborted) return;
      if (id)
        void navigate(studyHref("practice", { thread: id }), { state: studyReturnState(state) });
      else toast.error(t("study.followUps.practiceUnavailable"));
    } catch (error) {
      if (!loading.signal.aborted)
        toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      request.current = null;
      if (!loading.signal.aborted) setOpening(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      aria-describedby={description}
      loading={opening}
      disabled={disabled}
      onClick={() => void open()}
    >
      {t(resume ? "study.followUps.resumePractice" : "study.followUps.practice")}
    </Button>
  );
}

export function StudyFollowUps({
  threads,
  today,
  vaultId,
}: {
  threads: StudyThread[];
  today: number;
  vaultId: string;
}) {
  const { t } = useTranslation("home");
  const listId = useId();
  const steps = plannedStudySteps(threads);
  const threadIds = new Set(threads.map(({ id }) => id));
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
              <div className="min-w-0 basis-full sm:flex-1">
                <DirectionalText id={id} text={text} className="wrap-break-word" />
                <DirectionalText text={title} className="truncate text-xs text-muted-foreground" />
              </div>
              <StudyOriginLink origin={{ kind: "report", threadId, reportId }} />
              {action === "complete" ? (
                <StudyFollowUpButton
                  target={{ threadId, reportId, index }}
                  vaultId={vaultId}
                  resume={threadIds.has(studyFollowUpId({ threadId, reportId, index }))}
                  description={id}
                />
              ) : null}
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
