import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useStudyClock } from "@/components/study/use-study-clock";
import { useNotebookStudy } from "@/lib/db/study";
import { vaultOf } from "@/lib/db/vaults";
import { studyHref } from "@/lib/study/links";
import { reviewCollection, reviewQueue } from "@/lib/study/review-session";
import { cn } from "@/lib/utils";
import { useWorkspace } from "./workspace-context";

const link =
  "rounded-md px-1 font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

/**
 * One line under the top bar of a notebook that has Study items: how many of
 * its flashcards and highlights are due, and links to review and practise
 * this notebook alone.
 */
export function NotebookStudyStrip({ className }: { className?: string }) {
  const { t } = useTranslation("workspace");
  const { notebook } = useWorkspace();
  const rows = useNotebookStudy(notebook.id);
  const items = useMemo(
    () => reviewCollection(rows ?? [], new URLSearchParams({ notebook: notebook.id })),
    [rows, notebook.id],
  );
  const now = useStudyClock(items);
  if (!rows?.length) return null;
  const due = reviewQueue(items, null, now).length;
  const scope = { notebook: notebook.id, vault: vaultOf(notebook) };
  return (
    <nav
      aria-label={t("study.label")}
      className={cn(
        "flex min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-muted-foreground",
        className,
      )}
    >
      <span className="tabular-nums">{due ? t("study.due", { count: due }) : t("study.nothingDue")}</span>
      <span aria-hidden="true">·</span>
      <Link to={studyHref("review", scope)} className={link}>
        {t("study.review")}
      </Link>
      <span aria-hidden="true">·</span>
      <Link to={studyHref("practice", scope)} className={link}>
        {t("study.practise")}
      </Link>
    </nav>
  );
}
