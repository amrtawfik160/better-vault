import { useLocation, useSearchParams } from "react-router";
import { useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { subscriptionConnectionsAllowed } from "@/lib/ai/cliproxyapi-client";
import { stableContext } from "@/lib/context";
import type { Conversation, Notebook, StudioOutput } from "@/lib/db/database";
import { studyReturnState } from "@/lib/study/return-links";
import type { StudioToolId } from "@/studio/tools";

/**
 * What the notebook's main column shows: its overview, its sources (to choose
 * what Ask reads), or Studio (an output, or the list of them). "chat" is kept
 * for links and callers that ask for the chat: it opens Ask in the companion.
 */
export type WorkspaceTab = "overview" | "sources" | "studio" | "chat";
export type MainView = Exclude<WorkspaceTab, "chat">;
/** The companion panel beside the main column. */
export type CompanionTab = "ask" | "practise" | "make";

/** Wide screens dock the companion; narrower ones lay it over the page when it is opened. */
export const companionDockQuery = "(min-width: 1280px)";

/** A rename or delete asked for on a conversation in History. */
export interface ConversationAction {
  kind: "rename" | "delete";
  conversation: Conversation;
}

/** A rename or delete asked for on a Studio output. */
export interface OutputAction {
  kind: "rename" | "delete";
  output: StudioOutput;
}

interface WorkspaceState {
  notebook: Notebook;
  /** The main column's view. */
  tab: MainView;
  /** Shows a view in the main column; "chat" opens Ask in the companion instead. */
  setTab: (tab: WorkspaceTab) => void;
  /** The companion's open tab, or null while it is closed. */
  companion: CompanionTab | null;
  setCompanion: (tab: CompanionTab | null) => void;
  /** The Studio output shown in the Studio tab. */
  openOutputId: string | null;
  openOutput: (id: string) => void;
  closeOutput: () => void;
  /** The plugin panel shown in the Studio tab, instead of an output. */
  openPanel: { pluginId: string; panelId: string } | null;
  /** Closes the Studio sheet and shows a plugin's panel in the Studio tab. */
  openPluginPanel: (pluginId: string, panelId: string) => void;
  closePluginPanel: () => void;
  studioOpen: boolean;
  setStudioOpen: (open: boolean) => void;
  settingsOpen: boolean;
  settingsPage: "subscriptions" | "providers" | null;
  openModelSetup: () => void;
  /** Opens Settings on one page, e.g. the API keys an image model needs. */
  openSettings: (page: "subscriptions" | "providers") => void;
  setSettingsOpen: (open: boolean) => void;
  addSourceOpen: boolean;
  setAddSourceOpen: (open: boolean) => void;
  /** The History sheet: the notebook's chats. */
  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;
  conversationAction: ConversationAction | null;
  /** Closes the History sheet and asks to rename or delete a conversation. */
  requestConversationAction: (action: ConversationAction) => void;
  clearConversationAction: () => void;
  /** The Studio tool whose dialog is open. */
  activeTool: StudioToolId | null;
  /** The sources the open dialog starts with, when it was opened for them (from Study). */
  toolSources: string[] | null;
  /** Closes the Studio sheet and opens a tool's dialog, optionally for given sources. */
  openTool: (id: StudioToolId, sourceIds?: string[]) => void;
  closeTool: () => void;
  outputAction: OutputAction | null;
  /** Closes the Studio sheet and asks to rename or delete an output. */
  requestOutputAction: (action: OutputAction) => void;
  clearOutputAction: () => void;
  /** The source shown in the reader, and the passage to scroll to. */
  reading: { sourceId: string; passage?: string; snippet?: string } | null;
  readSource: (sourceId: string, passage?: string, snippet?: string) => void;
  closeReader: () => void;
}

const WorkspaceContext = stableContext<WorkspaceState | null>("workspace", null);

/**
 * The notebook screen's state. Dialogs opened from a sheet live here, outside
 * the sheet, so the sheet can close as its dialog opens.
 */
export function WorkspaceProvider({
  notebook,
  children,
}: {
  notebook: Notebook;
  children: ReactNode;
}) {
  const [openPanel, setOpenPanel] = useState<WorkspaceState["openPanel"]>(null);
  const [params, setParams] = useSearchParams();
  const { state } = useLocation();
  const openOutputId = params.get("output");
  const [workspaceTab, setWorkspaceTab] = useState<MainView>(() =>
    params.has("output") ? "studio" : "overview",
  );
  // Open beside the overview on wide screens, and when a link asks for the chat or an answer.
  const [companion, setCompanion] = useState<CompanionTab | null>(() => {
    if (params.get("tab") === "chat" || params.has("answer")) return "ask";
    try {
      return window.matchMedia(companionDockQuery).matches ? "ask" : null;
    } catch {
      return null;
    }
  });
  const tab = openOutputId ? "studio" : workspaceTab;
  const setTab = useCallback(
    (next: WorkspaceTab) => {
      if (next === "chat") {
        setCompanion("ask");
        return;
      }
      setWorkspaceTab(next);
      if (next !== "studio" && openOutputId)
        setParams(
          (current) => {
            const updated = new URLSearchParams(current);
            updated.delete("output");
            return updated;
          },
          { state: studyReturnState(state) },
        );
    },
    [openOutputId, setParams, state],
  );
  const [studioOpen, setStudioOpen] = useState(false);
  const [settingsOpen, showSettings] = useState(false);
  const [settingsPage, setSettingsPage] = useState<WorkspaceState["settingsPage"]>(null);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversationAction, setConversationAction] = useState<ConversationAction | null>(null);
  const [activeTool, setActiveTool] = useState<StudioToolId | null>(null);
  const [toolSources, setToolSources] = useState<string[] | null>(null);
  const [outputAction, setOutputAction] = useState<OutputAction | null>(null);
  const [reading, setReading] = useState<WorkspaceState["reading"]>(null);

  const value = useMemo<WorkspaceState>(
    () => ({
      notebook,
      tab,
      setTab,
      companion,
      setCompanion,
      openOutputId,
      openOutput: (id) => {
        setOpenPanel(null);
        setStudioOpen(false);
        setWorkspaceTab("studio");
        setParams({ output: id }, { state: studyReturnState(state) });
      },
      closeOutput: () => {
        setWorkspaceTab("studio");
        setParams(
          (current) => {
            const updated = new URLSearchParams(current);
            updated.delete("output");
            return updated;
          },
          { state: studyReturnState(state) },
        );
      },
      openPanel,
      openPluginPanel: (pluginId, panelId) => {
        setStudioOpen(false);
        setWorkspaceTab("studio");
        // A panel shows in place of an open output.
        setParams(
          (current) => {
            const updated = new URLSearchParams(current);
            updated.delete("output");
            return updated;
          },
          { state: studyReturnState(state) },
        );
        setOpenPanel({ pluginId, panelId });
      },
      closePluginPanel: () => setOpenPanel(null),
      studioOpen,
      setStudioOpen,
      settingsOpen,
      settingsPage,
      setSettingsOpen: (open) => {
        if (!open) setSettingsPage(null);
        showSettings(open);
      },
      openModelSetup: () => {
        setSettingsPage(subscriptionConnectionsAllowed() ? "subscriptions" : "providers");
        showSettings(true);
      },
      openSettings: (page) => {
        setSettingsPage(page);
        showSettings(true);
      },
      addSourceOpen,
      setAddSourceOpen,
      historyOpen,
      setHistoryOpen,
      conversationAction,
      requestConversationAction: (action) => {
        setHistoryOpen(false);
        setConversationAction(action);
      },
      clearConversationAction: () => setConversationAction(null),
      activeTool,
      toolSources,
      openTool: (id, sourceIds) => {
        setStudioOpen(false);
        setToolSources(sourceIds ?? null);
        setActiveTool(id);
      },
      closeTool: () => {
        setActiveTool(null);
        setToolSources(null);
      },
      outputAction,
      requestOutputAction: (action) => {
        setStudioOpen(false);
        setOutputAction(action);
      },
      clearOutputAction: () => setOutputAction(null),
      reading,
      readSource: (sourceId, passage, snippet) => setReading({ sourceId, passage, snippet }),
      closeReader: () => setReading(null),
    }),
    [
      notebook,
      tab,
      companion,
      openOutputId,
      openPanel,
      studioOpen,
      settingsOpen,
      settingsPage,
      addSourceOpen,
      historyOpen,
      conversationAction,
      activeTool,
      toolSources,
      outputAction,
      reading,
      setParams,
      setTab,
      state,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside <WorkspaceProvider>.");
  return context;
}
