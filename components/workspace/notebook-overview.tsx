import { Add01Icon, ArrowRight01Icon, Book02Icon, Bookmark02Icon } from "@hugeicons/core-free-icons";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { DirectionalText } from "@/components/common/directional-text";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { readingLink } from "@/components/sources/source-reader";
import { sourceKindIcons } from "@/components/sources/source-kind";
import { useStudyClock } from "@/components/study/use-study-clock";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useOutputs } from "@/lib/db/outputs";
import { useSources } from "@/lib/db/sources";
import { sourceHasText } from "@/lib/db/source-text";
import { studyBookForSource, useNotebookStudy } from "@/lib/db/study";
import type { Source } from "@/lib/db/types";
import { vaultOf } from "@/lib/db/vaults";
import { studyHref } from "@/lib/study/links";
import { studyReadingProgress } from "@/lib/study/reading-progress";
import type { StudyBook } from "@/lib/study/records";
import { studyReturnState } from "@/lib/study/return-links";
import { reviewCollection, reviewQueue } from "@/lib/study/review-session";
import { studioTools, type StudioToolId } from "@/studio/tools";
import { useWorkspace } from "./workspace-context";

const ROWS = 5;

/**
 * The notebook's main page: where you are in it (the document read last, how
 * far, and the line you left off at), how its cards stand, and everything in
 * it — documents, outputs — each one click from being read or opened.
 */
export function NotebookOverview() {
  const { t, i18n } = useTranslation("workspace");
  const { t: tSources } = useTranslation("sources");
  const { t: tStudio } = useTranslation("studio");
  const { notebook, setAddSourceOpen, readSource, openOutput, setTab, setCompanion } = useWorkspace();
  const sources = useSources(notebook.id);
  const outputs = useOutputs(notebook.id);
  const rows = useNotebookStudy(notebook.id);
  const navigate = useNavigate();
  const { state } = useLocation();
  const [opening, setOpening] = useState(false);
  const [allDocuments, setAllDocuments] = useState(false);
  const [allOutputs, setAllOutputs] = useState(false);
  const books = useMemo(
    () => (rows ?? []).filter((row): row is StudyBook => row.kind === "book"),
    [rows],
  );
  const items = useMemo(
    () => reviewCollection(rows ?? [], new URLSearchParams({ notebook: notebook.id })),
    [rows, notebook.id],
  );
  const now = useStudyClock(items);
  if (!sources) return null;

  const scope = { notebook: notebook.id, vault: vaultOf(notebook) };
  const due = reviewQueue(items, null, now).length;
  const cards = items.filter((item) => item.kind === "card").length;
  const lastRead = books
    .filter((book) => book.lastReadAt !== undefined)
    .toSorted((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0];
  const bookBySource = new Map(books.map((book) => [book.sourceId, book]));

  /** Opens a source in the reader, making it a Study document the first time. */
  async function read(source: Source) {
    const book = bookBySource.get(source.id);
    if (!book && !sourceHasText(source)) return readSource(source.id);
    if (opening) return;
    setOpening(true);
    try {
      navigate(readingLink(book ?? (await studyBookForSource(source.id)), undefined), {
        state: studyReturnState(state),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setOpening(false);
    }
  }

  if (sources.length === 0)
    return (
      <ScrollArea className="h-full">
        <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-6 py-16">
          <h2 className="text-lg font-medium">{t("overview.empty.title")}</h2>
          <p className="mt-1 text-sm text-pretty text-muted-foreground">{t("overview.empty.body")}</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button onClick={() => setAddSourceOpen(true)}>
              <Icon icon={Add01Icon} size={16} />
              {t("overview.add")}
            </Button>
            <p className="text-sm text-muted-foreground">
              {t("overview.empty.goesTo", { notebook: notebook.title })}
            </p>
          </div>
        </div>
      </ScrollArea>
    );

  const relativeDay = (at: number) => {
    const day = (value: number) => new Date(value).toDateString();
    if (day(at) === day(now)) return t("overview.openedToday");
    if (day(at) === day(now - 86_400_000)) return t("overview.openedYesterday");
    return t("overview.openedOn", {
      date: new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric" }).format(at),
    });
  };
  const documents = allDocuments ? sources : sources.slice(0, ROWS);
  const madeOutputs = outputs ?? [];
  const shownOutputs = allOutputs ? madeOutputs : madeOutputs.slice(0, ROWS);

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto w-full max-w-3xl space-y-10 px-4 pt-6 pb-16 sm:px-8">
        {lastRead ? <WhereYouAre book={lastRead} opened={relativeDay(lastRead.lastReadAt ?? now)} /> : null}

        <section aria-label={t("overview.study")} className="grid gap-3 sm:grid-cols-2">
          <Stat
            value={t("overview.cards", { count: cards })}
            detail={due ? t("overview.due", { count: due }) : t("overview.nothingDue")}
            action={cards ? { label: t("study.review"), to: studyHref("review", scope) } : undefined}
          />
          <Stat
            value={t("overview.documents", { count: sources.length })}
            detail={t("overview.practiseDetail")}
            action={{ label: t("study.practise"), to: studyHref("practice", scope) }}
          />
        </section>

        <section aria-labelledby="overview-everything" className="space-y-6">
          <h2 id="overview-everything" className="text-sm font-medium text-muted-foreground">
            {t("overview.everything")}
          </h2>

          <Group
            title={t("overview.documentsTitle", { count: sources.length })}
            action={
              <Button variant="ghost" size="sm" onClick={() => setTab("sources")}>
                {t("overview.chooseSources")}
              </Button>
            }
          >
            {documents.map((source) => {
              const book = bookBySource.get(source.id);
              const progress = book ? Math.round(studyReadingProgress(book) * 100) : 0;
              const detail = book?.lastReadAt
                ? [book.sections[book.section]?.title, t("overview.percent", { percent: progress })].filter(Boolean).join(" · ")
                : [tSources(`kinds.${source.kind}`), t("overview.notOpened")].join(" · ");
              return (
                <Row
                  key={source.id}
                  icon={<Icon icon={sourceKindIcons[source.kind]} size={16} className="text-muted-foreground" />}
                  title={source.title}
                  detail={detail}
                  onClick={() => void read(source)}
                />
              );
            })}
            {sources.length > ROWS && !allDocuments ? (
              <More label={t("overview.showAll", { count: sources.length })} onClick={() => setAllDocuments(true)} />
            ) : null}
          </Group>

          <Group
            title={t("overview.outputsTitle", { count: madeOutputs.length })}
            action={
              <Button variant="ghost" size="sm" onClick={() => setCompanion("make")}>
                {t("overview.makeSomething")}
              </Button>
            }
          >
            {madeOutputs.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">{t("overview.noOutputs")}</p>
            ) : (
              shownOutputs.map((output) => {
                const meta = studioTools[output.toolId as StudioToolId];
                return (
                  <Row
                    key={output.id}
                    icon={meta ? <Icon icon={meta.icon} size={16} className={meta.tint} /> : null}
                    title={output.title}
                    detail={
                      output.status === "generating"
                        ? tStudio("status.generating")
                        : output.status === "error"
                          ? tStudio("status.failed")
                          : meta
                            ? tStudio(`tools.${meta.id}.name`)
                            : ""
                    }
                    onClick={() => openOutput(output.id)}
                  />
                );
              })
            )}
            {madeOutputs.length > ROWS && !allOutputs ? (
              <More label={t("overview.showAll", { count: madeOutputs.length })} onClick={() => setAllOutputs(true)} />
            ) : null}
          </Group>
        </section>
      </div>
    </ScrollArea>
  );
}

/** The document read last: where you left off, how far, and Continue reading. */
function WhereYouAre({ book, opened }: { book: StudyBook; opened: string }) {
  const { t } = useTranslation("workspace");
  const progress = Math.round(studyReadingProgress(book) * 100);
  const section = book.sections[book.section];
  const excerpt = book.readingPlace?.section === book.section ? book.readingPlace.anchor?.quote : undefined;
  return (
    <section aria-labelledby="overview-where" className="space-y-4 rounded-2xl border bg-card p-6">
      <div className="space-y-1">
        <h2 id="overview-where" className="text-xs font-medium text-muted-foreground">
          {t("overview.where")}
        </h2>
        <DirectionalText as="p" text={book.title} className="font-serif text-2xl font-semibold text-pretty" />
        <p className="text-sm text-muted-foreground tabular-nums">
          {[
            section?.title ? t("overview.leftOff", { section: section.title }) : "",
            t("overview.percentRead", { percent: progress }),
            t("overview.sections", { count: book.sections.length }),
            opened,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div aria-hidden className="h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, progress)}%` }} />
      </div>
      {excerpt ? (
        <p className="flex gap-2 text-sm text-muted-foreground">
          <Icon icon={Bookmark02Icon} size={14} className="mt-0.5 shrink-0" />
          <DirectionalText as="span" text={excerpt} className="line-clamp-2 font-serif text-base text-foreground" />
        </p>
      ) : null}
      <Link
        to={readingLink(book, undefined)}
        className="inline-flex h-9 items-center gap-2 rounded-lg border bg-background px-4 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <Icon icon={Book02Icon} size={16} />
        {t("overview.continue")}
      </Link>
    </section>
  );
}

function Stat({
  value,
  detail,
  action,
}: {
  value: string;
  detail: string;
  action?: { label: string; to: string };
}) {
  return (
    <div className="flex min-h-20 items-center gap-3 rounded-2xl border px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium tabular-nums">{value}</p>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
      {action ? (
        <Link
          to={action.to}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-3 text-[0.8125rem] font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          {action.label}
          <Icon icon={ArrowRight01Icon} size={14} className="rtl:rotate-180" />
        </Link>
      ) : null}
    </div>
  );
}

function Group({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {action}
      </div>
      <ul className="divide-y rounded-2xl border">{children}</ul>
    </div>
  );
}

function Row({
  icon,
  title,
  detail,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-2xl px-4 py-2 text-start outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
        <span className="min-w-0 flex-1">
          <DirectionalText as="span" text={title} className="block truncate text-sm font-medium" />
          {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
        </span>
      </button>
    </li>
  );
}

function More({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-11 w-full cursor-pointer items-center rounded-2xl px-4 text-start text-sm text-muted-foreground outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        {label}
      </button>
    </li>
  );
}
