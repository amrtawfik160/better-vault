import { Cards01Icon } from "@hugeicons/core-free-icons";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { Icon } from "@/components/icon";
import { Button, buttonVariants } from "@/components/panelui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useOutputs } from "@/lib/db/outputs";
import { modelFor, useSettings } from "@/lib/db/settings";
import { useNotebookStudy } from "@/lib/db/study";
import { originHref, studyHref } from "@/lib/study/links";
import type { StudyBook } from "@/lib/study/records";
import { studyReturnState } from "@/lib/study/return-links";
import { useStudioSettings } from "@/lib/studio/settings";
import { cn } from "@/lib/utils";
import { toolDefinitions } from "@/studio/definitions";
import { studioMakeHref } from "@/studio/make-link";
import { studioToolIds, studioTools } from "@/studio/tools";
import { StudyBookNotes } from "./study-make-from-book";

const rowClass =
  "flex min-h-11 w-full items-center gap-3 border-b px-3 py-2 text-start outline-none last:border-b-0 hover:bg-foreground/[0.03] focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/40";

/**
 * The companion's Make tab: cards from the part on screen (the reader's own
 * card-making flow), the Studio tools that open on this document, what this
 * notebook has made, and how many cards it holds.
 */
export function StudyReaderMake({
  book,
  partInline,
  notebookTitle,
  canMakeCards,
  makeCards,
  setupModel,
}: {
  book: StudyBook;
  /** The part on screen, in a sentence: "chapter 7". */
  partInline: string;
  notebookTitle?: string;
  /** Whether the part on screen has text to make cards from. */
  canMakeCards: boolean;
  makeCards: () => void;
  /** Opens Settings → AI providers. */
  setupModel?: () => void;
}) {
  const { t } = useTranslation("home");
  const { t: tStudio } = useTranslation("studio");
  const location = useLocation();
  const returnState = studyReturnState(location.state);
  const settings = useSettings();
  const studio = useStudioSettings();
  const outputs = useOutputs(book.notebookId);
  const rows = useNotebookStudy(book.notebookId);
  const cards = rows?.filter((row) => row.kind === "card").length;
  const reasonId = useId();
  const noModel = settings !== undefined && !modelFor(settings, "cards");
  const blocked = noModel || !canMakeCards;
  // Tools made in the browser (whiteboard, canvas) and Notes have no dialog to open on a document.
  const tools = studioToolIds.filter(
    (id) => id !== "notes" && !toolDefinitions[id]?.local && studioTools[id].available && !studio?.hidden.includes(id),
  );

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-6 p-4">
        <section className="space-y-2">
          {noModel ? (
            <div className="flex items-center gap-3 rounded-xl border px-3 py-2">
              <p className="min-w-0 flex-1 text-[0.8125rem] text-muted-foreground">{t("study.readerCompanion.make.noModel")}</p>
              {setupModel ? (
                <Button size="sm" variant="secondary" className="border border-input" onClick={setupModel}>
                  {t("study.readerCompanion.make.addKey")}
                </Button>
              ) : null}
            </div>
          ) : null}
          <Button
            size="lg"
            variant={blocked ? "outline" : "secondary"}
            className={cn("w-full", blocked ? "cursor-not-allowed text-muted-foreground hover:bg-background" : "border border-input")}
            aria-disabled={blocked || undefined}
            aria-describedby={reasonId}
            onClick={() => {
              if (!blocked) makeCards();
            }}
          >
            <Icon icon={Cards01Icon} size={16} />
            {t("study.readerCompanion.make.makeCards", { part: partInline })}
          </Button>
          <p id={reasonId} className="text-xs text-muted-foreground">
            {!canMakeCards
              ? t("study.readerCompanion.make.noText")
              : notebookTitle
                ? t("study.readerCompanion.make.cardsGo", { notebook: notebookTitle })
                : t("study.readerCompanion.make.cardsGoAnywhere")}
          </p>
        </section>

        <section aria-labelledby={`${reasonId}-tools`} className="space-y-2">
          <h3 id={`${reasonId}-tools`} className="text-xs font-medium text-muted-foreground">
            {t("study.readerCompanion.make.tools")}
          </h3>
          <ul className="overflow-hidden rounded-xl border">
            {tools.map((id) => (
              <li key={id}>
                <Link to={studioMakeHref(book.notebookId, id, book.sourceId)} state={returnState} className={rowClass}>
                  <Icon icon={studioTools[id].icon} size={16} className={studioTools[id].tint} />
                  <span className="min-w-0 flex-1 text-sm">{tStudio(`tools.${id}.name`)}</span>
                  <span className="max-w-[55%] truncate text-xs text-muted-foreground">{tStudio(`tools.${id}.description`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby={`${reasonId}-outputs`} className="space-y-2">
          <h3 id={`${reasonId}-outputs`} className="text-xs font-medium text-muted-foreground" dir="auto">
            {notebookTitle
              ? t("study.readerCompanion.make.outputs", { notebook: notebookTitle })
              : t("study.readerCompanion.make.outputsHere")}
          </h3>
          {outputs?.length ? (
            <ul className="overflow-hidden rounded-xl border">
              {outputs.slice(0, 8).map((output) => {
                const meta = studioTools[output.toolId as keyof typeof studioTools];
                return (
                  <li key={output.id}>
                    <Link
                      to={originHref({ kind: "studio", notebookId: book.notebookId, outputId: output.id })}
                      state={returnState}
                      className={rowClass}
                    >
                      {meta ? <Icon icon={meta.icon} size={16} className={meta.tint} /> : null}
                      <span className="min-w-0 flex-1 truncate text-sm" dir="auto">{output.title}</span>
                      {output.status === "error" || output.status === "generating" ? (
                        <span className="text-xs text-muted-foreground">
                          {tStudio(output.status === "error" ? "status.failed" : "status.generating")}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : outputs ? (
            <p className="text-[0.8125rem] text-muted-foreground">{t("study.readerCompanion.make.noOutputs")}</p>
          ) : null}
        </section>

        <section aria-labelledby={`${reasonId}-cards`} className="space-y-2">
          <h3 id={`${reasonId}-cards`} className="text-xs font-medium text-muted-foreground">
            {t("study.readerCompanion.make.cards")}
          </h3>
          <div className="flex min-h-11 items-center gap-3 rounded-xl border px-3 py-1.5">
            <Icon icon={Cards01Icon} size={16} className="text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm tabular-nums" dir="auto">
              {notebookTitle
                ? t("study.readerCompanion.make.cardsCount", { count: cards ?? 0, notebook: notebookTitle })
                : t("study.readerCompanion.make.cardsCountHere", { count: cards ?? 0 })}
            </span>
            <Link
              to={studyHref("cards", { notebook: book.notebookId })}
              state={returnState}
              aria-label={t("study.readerCompanion.make.openCards")}
              className={buttonVariants({ size: "sm", variant: "ghost" })}
            >
              {t("study.readerCompanion.make.open")}
            </Link>
          </div>
        </section>

        <StudyBookNotes book={book} limit={5} />
      </div>
    </ScrollArea>
  );
}
