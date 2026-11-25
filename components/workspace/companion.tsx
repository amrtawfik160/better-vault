import {
  Add01Icon,
  BubbleChatIcon,
  Cancel01Icon,
  Cards01Icon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { HistorySheet } from "@/components/chat/history-sheet";
import { PromptBar } from "@/components/chat/prompt-bar";
import { useChatSession } from "@/components/chat/chat-provider";
import { Icon } from "@/components/icon";
import { Button, buttonVariants } from "@/components/panelui/button";
import { Tabs } from "@/components/panelui/tabs";
import { StudioSheet } from "@/components/studio/studio-sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useOutputs } from "@/lib/db/outputs";
import { useSources } from "@/lib/db/sources";
import { selectedTextSource } from "@/lib/db/source-text";
import { vaultOf } from "@/lib/db/vaults";
import { studyHref } from "@/lib/study/links";
import { useStudioSettings } from "@/lib/studio/settings";
import { cn } from "@/lib/utils";
import { toolDefinitions } from "@/studio/definitions";
import { studioToolIds, studioTools } from "@/studio/tools";
import { ChatView } from "./chat-view";
import { companionDockQuery, useWorkspace, type CompanionTab } from "./workspace-context";

function subscribeDock(change: () => void) {
  const query = window.matchMedia(companionDockQuery);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
}

/** Whether the companion sits beside the main column (wide screens) or over it. */
export function useCompanionDocked() {
  return useSyncExternalStore(
    subscribeDock,
    () => window.matchMedia(companionDockQuery).matches,
    () => true,
  );
}

/**
 * The companion beside the notebook: Ask (the one chat about the notebook),
 * Practise (start an exercise on it) and Make (cards and Studio outputs).
 * Docked from 1280px; below, it lies over the page and Escape closes it.
 * It stays in the page while closed, so a draft in Ask survives.
 */
export function Companion() {
  const { t } = useTranslation("workspace");
  const { companion, setCompanion } = useWorkspace();
  const docked = useCompanionDocked();
  const open = companion !== null;

  useEffect(() => {
    if (!open || docked) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setCompanion(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, docked, setCompanion]);

  return (
    <aside
      id="companion"
      aria-label={t("companion.label")}
      hidden={!open}
      className={cn(
        "flex min-h-0 flex-col bg-card",
        docked
          ? "w-[26rem] shrink-0 border-s"
          : "fixed inset-y-0 end-0 z-40 w-full max-w-md border-s shadow-2xl",
      )}
    >
      <Tabs
        value={companion ?? "ask"}
        onValueChange={(value) => setCompanion(value as CompanionTab)}
        className="flex h-full min-h-0 flex-col gap-0"
      >
        <div className="flex h-13 shrink-0 items-center gap-2 border-b px-3">
          <Tabs.List aria-label={t("companion.label")} className="flex-1">
            <Tabs.Trigger value="ask">{t("companion.ask")}</Tabs.Trigger>
            <Tabs.Trigger value="practise">{t("companion.practise")}</Tabs.Trigger>
            <Tabs.Trigger value="make">{t("companion.make")}</Tabs.Trigger>
          </Tabs.List>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("companion.close")}
            onClick={() => setCompanion(null)}
          >
            <Icon icon={Cancel01Icon} size={16} />
          </Button>
        </div>
        {/* Ask stays mounted, so its draft and scroll survive a switch to Practise or Make. */}
        <Tabs.Content value="ask" keepMounted className="flex min-h-0 flex-1 flex-col">
          <AskPanel />
        </Tabs.Content>
        <Tabs.Content value="practise" className="min-h-0 flex-1">
          <PractisePanel />
        </Tabs.Content>
        <Tabs.Content value="make" className="min-h-0 flex-1">
          <MakePanel />
        </Tabs.Content>
      </Tabs>
    </aside>
  );
}

/** Below 1280px the companion lies over the page: it steps aside for what it opened there. */
function useStepAside() {
  const docked = useCompanionDocked();
  const { setCompanion } = useWorkspace();
  return () => {
    if (!docked) setCompanion(null);
  };
}

function AskPanel() {
  const { t } = useTranslation("workspace");
  const { t: tChat } = useTranslation("chat");
  const { notebook, setTab } = useWorkspace();
  const stepAside = useStepAside();
  const chat = useChatSession();
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <span className="text-xs text-muted-foreground">{t("companion.answersFrom")}</span>
        <button
          type="button"
          onClick={() => {
            setTab("sources");
            stepAside();
          }}
          aria-label={t("companion.scopeLabel", { notebook: notebook.title })}
          className="inline-flex h-7 min-w-0 cursor-pointer items-center gap-2 rounded-full border border-chart-5/50 bg-chart-5/15 px-3 text-[0.8125rem] font-medium outline-none hover:bg-chart-5/25 focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <span aria-hidden className="h-3 w-0.5 shrink-0 rounded-full bg-chart-5" />
          <span className="truncate">{notebook.title}</span>
        </button>
        <span className="ms-auto flex items-center gap-1">
          <HistorySheet
            trigger={
              <Button variant="ghost" size="icon-sm" aria-label={tChat("history.open")} title={tChat("history.title")}>
                <Icon icon={BubbleChatIcon} size={16} />
              </Button>
            }
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("companion.newQuestion")}
            title={t("companion.newQuestion")}
            disabled={chat.messages.length === 0}
            onClick={() => chat.startNew()}
          >
            <Icon icon={PencilEdit02Icon} size={16} />
          </Button>
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <ChatView />
        <PromptBar />
      </div>
    </>
  );
}

function PractisePanel() {
  const { t } = useTranslation("workspace");
  const { t: tHome } = useTranslation("home");
  const { notebook } = useWorkspace();
  const sources = useSources(notebook.id);
  const count = sources?.filter(selectedTextSource).length ?? 0;
  const scope = { notebook: notebook.id, vault: vaultOf(notebook) };
  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-5">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("companion.material")}</p>
          <p className="text-sm font-medium">
            {notebook.title}
            <span className="font-normal text-muted-foreground"> · {t("overview.documents", { count })}</span>
          </p>
        </div>
        <ul className="space-y-2">
          {(["teach", "questions", "roleplay"] as const).map((exercise) => (
            <li key={exercise} className="rounded-xl border px-4 py-3">
              <p className="text-sm font-medium">{tHome(`study.practicePage.exercises.${exercise}.name`)}</p>
              <p className="text-[0.8125rem] text-muted-foreground">
                {tHome(`study.practicePage.exercises.${exercise}.short`)}
              </p>
            </li>
          ))}
        </ul>
        {count ? (
          <Link to={studyHref("practice", scope)} className={buttonVariants({ className: "w-full" })}>
            {tHome("study.practicePage.start")}
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">{t("companion.needsMaterial")}</p>
        )}
        <p className="text-xs text-muted-foreground">{t("companion.practiseHint")}</p>
      </div>
    </ScrollArea>
  );
}

function MakePanel() {
  const { t } = useTranslation("workspace");
  const { t: tStudio } = useTranslation("studio");
  const { notebook, openTool, openOutput, setCompanion, studioOpen, setStudioOpen } = useWorkspace();
  const chat = useChatSession();
  const stepAside = useStepAside();
  const outputs = useOutputs(notebook.id);
  const studio = useStudioSettings();
  const sources = useSources(notebook.id);
  const hasMaterial = (sources?.filter(selectedTextSource).length ?? 0) > 0;
  const busy = chat.status === "submitted" || chat.status === "streaming";
  // Tools made in the browser (whiteboard, canvas) and Notes are in the full Studio sheet.
  const tools = studioToolIds.filter(
    (id) => id !== "notes" && !toolDefinitions[id]?.local && studioTools[id].available && !studio?.hidden.includes(id),
  );
  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-5">
        <div className="space-y-2">
          <Button
            variant="secondary"
            className="w-full"
            disabled={!hasMaterial || busy}
            onClick={() => {
              setCompanion("ask");
              chat.runCommand("/cards");
            }}
          >
            <Icon icon={Cards01Icon} size={16} />
            {t("companion.makeCards", { notebook: notebook.title })}
          </Button>
          <p className="text-xs text-muted-foreground">{t("companion.cardsGo", { notebook: notebook.title })}</p>
        </div>

        <section aria-labelledby="make-tools" className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 id="make-tools" className="text-xs font-medium text-muted-foreground">
              {t("companion.tools")}
            </h3>
            <StudioSheet
              open={studioOpen}
              onOpenChange={setStudioOpen}
              trigger={
                <Button variant="ghost" size="sm">
                  <Icon icon={Add01Icon} size={14} />
                  {t("companion.allTools")}
                </Button>
              }
            />
          </div>
          <ul className="divide-y rounded-xl border">
            {tools.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => openTool(id)}
                  className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 py-2 text-start outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  <Icon icon={studioTools[id].icon} size={16} className={studioTools[id].tint} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{tStudio(`tools.${id}.name`)}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {tStudio(`tools.${id}.description`)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {outputs?.length ? (
          <section aria-labelledby="make-outputs" className="space-y-2">
            <h3 id="make-outputs" className="text-xs font-medium text-muted-foreground">
              {t("companion.made", { count: outputs.length })}
            </h3>
            <ul className="divide-y rounded-xl border">
              {outputs.map((output) => {
                const meta = studioTools[output.toolId as keyof typeof studioTools];
                return (
                  <li key={output.id}>
                    <button
                      type="button"
                      onClick={() => {
                        openOutput(output.id);
                        stepAside();
                      }}
                      className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 py-2 text-start outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/40"
                    >
                      {meta ? <Icon icon={meta.icon} size={16} className={meta.tint} /> : null}
                      <span className="min-w-0 flex-1 truncate text-sm">{output.title}</span>
                      {output.status !== "ready" ? (
                        <span className="text-xs text-muted-foreground">
                          {tStudio(output.status === "error" ? "status.failed" : "status.generating")}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </ScrollArea>
  );
}
