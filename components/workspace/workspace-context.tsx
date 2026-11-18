import { useLocation, useSearchParams } from "react-router";
import { useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { subscriptionConnectionsAllowed } from "@/lib/ai/cliproxyapi-client";
import { stableContext } from "@/lib/context";
import type { Conversation, Notebook, StudioOutput } from "@/lib/db/database";
import { studyReturnState } from "@/lib/study/return-links";
import type { StudioToolId } from "@/studio/tools";

export type WorkspaceTab = "chat" | "sources" | "studio";

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
  tab: WorkspaceTab;
  setTab: (tab: WorkspaceTab) => void;
  /** The Studio output shown in the Studio tab. */
  openOutputId: string | null;
  openOutput: (id: string) => void;
  closeOutput: () => void;
  studioOpen: boolean;
  setStudioOpen: (open: boolean) => void;
  settingsOpen: boolean;
  settingsPage: "subscriptions" | "providers" | null;
  openModelSetup: () => void;
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
  /** Closes the Studio sheet and opens a tool's dialog. */
  openTool: (id: StudioToolId) => void;
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
  const [params, setParams] = useSearchParams();
  const { state } = useLocation();
  const openOutputId = params.get("output");
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(() =>
    params.has("output") ? "studio" : "chat",
  );
  const tab = openOutputId ? "studio" : workspaceTab;
  const setTab = useCallback(
    (next: WorkspaceTab) => {
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
  const [outputAction, setOutputAction] = useState<OutputAction | null>(null);
  const [reading, setReading] = useState<WorkspaceState["reading"]>(null);

  const value = useMemo<WorkspaceState>(
    () => ({
      notebook,
      tab,
      setTab,
      openOutputId,
      openOutput: (id) => {
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
      openTool: (id) => {
        setStudioOpen(false);
        setActiveTool(id);
      },
      closeTool: () => setActiveTool(null),
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
      openOutputId,
      studioOpen,
      settingsOpen,
      settingsPage,
      addSourceOpen,
      historyOpen,
      conversationAction,
      activeTool,
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
