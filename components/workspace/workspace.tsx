import { Link, useLocation, useSearchParams } from "react-router";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/icon";
import { Button, buttonVariants } from "@/components/panelui/button";
import { ChatProvider } from "@/components/chat/chat-provider";
import { ConversationActionDialogs } from "@/components/chat/conversation-action-dialogs";
import { OutputActionDialogs } from "@/components/studio/output-action-dialogs";
import { StudioRunnerProvider } from "@/components/studio/studio-runner";
import { ToolDialog } from "@/components/studio/tool-dialog";
import { AddSourceDialog } from "@/components/sources/add-source-dialog";
import { SourceReader } from "@/components/sources/source-reader";
import { AppFrame, Desk } from "@/components/shell/app-frame";
import { StudyReturnLinks } from "@/components/study/study-return-links";
import { useNotebook } from "@/lib/db/notebooks";
import { studyReturnState } from "@/lib/study/return-links";
import { Companion } from "./companion";
import { NotebookOverview } from "./notebook-overview";
import { SourcesView } from "./sources-view";
import { StudioView } from "./studio-view";
import { TopBar } from "./top-bar";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { routes } from "@/lib/routes";
import { studioMakeRequest } from "@/studio/make-link";

/** The notebook screen. */
export function Workspace({ notebookId }: { notebookId: string }) {
  const notebook = useNotebook(notebookId);
  if (notebook === undefined) return <div className="h-full" aria-busy="true" />;
  if (notebook === null)
    return (
      <AppFrame>
        <NotebookNotFound />
      </AppFrame>
    );
  return (
    <WorkspaceProvider notebook={notebook}>
      {/* The chat makes Studio outputs when asked, so the runner is outside it. */}
      <StudioRunnerProvider notebookId={notebook.id}>
        <ChatProvider notebookId={notebook.id}>
          {/* The app sidebar, then the notebook on its desk: the header, the main column and the companion. */}
          <AppFrame notebookId={notebook.id}>
            <Desk>
              <WorkspaceLayout />
            </Desk>
          </AppFrame>
        </ChatProvider>
      </StudioRunnerProvider>
    </WorkspaceProvider>
  );
}

function WorkspaceLayout() {
  const {
    notebook,
    tab,
    setTab,
    addSourceOpen,
    setAddSourceOpen,
    reading,
    closeReader,
    activeTool,
    toolSources,
    openTool,
    closeTool,
    readSource,
  } = useWorkspace();
  const { t } = useTranslation();
  const { key, state } = useLocation();
  const [params, setParams] = useSearchParams();
  const handled = useRef<string | null>(null);

  // The studio output stays in the URL. Source, Add source and Make links are one-shot commands.
  useEffect(() => {
    const source = params.get("source");
    const view = params.get("tab");
    const addSource = params.get("add") === "source";
    const make = studioMakeRequest(params);
    if ((!source && !view && !addSource && !make && !params.has("make")) || handled.current === key) return;
    handled.current = key;
    if (make) {
      setTab("studio");
      openTool(make.toolId, make.sourceIds);
    } else if (source) {
      setTab("sources");
      const snippet = state?.studySourceSnippet;
      readSource(
        source,
        params.get("passage") ?? undefined,
        typeof snippet === "string" ? snippet.slice(0, 280) : undefined,
      );
    } else if (view === "chat" || view === "sources" || view === "studio" || view === "overview") {
      setTab(view);
    }
    if (addSource) setAddSourceOpen(true);
    const rest = new URLSearchParams(params);
    for (const param of ["source", "passage", "add", "tab", "make", "from"]) rest.delete(param);
    if (make || source || view === "chat" || view === "sources") rest.delete("output");
    setParams(rest, { replace: true, state: studyReturnState(state) });
  }, [key, params, state, setParams, setTab, readSource, setAddSourceOpen, openTool]);

  useEffect(() => {
    document.title = `${notebook.title} · ${t("appName")}`;
  }, [notebook.title, t]);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <StudyReturnLinks className="shrink-0 px-3 sm:px-5" />
      <div className="flex min-h-0 flex-1">
        {/* The main column: the overview, the sources to choose from, or Studio. */}
        <main className="flex min-w-0 flex-1 flex-col">
          {tab !== "overview" ? (
            <div className="shrink-0 px-3 pt-2 sm:px-5">
              <Button variant="ghost" size="sm" onClick={() => setTab("overview")}>
                <Icon icon={ArrowLeft01Icon} size={16} className="rtl:rotate-180" />
                {t("overview.back", { ns: "workspace", notebook: notebook.title })}
              </Button>
            </div>
          ) : null}
          <div className="relative min-h-0 flex-1">
            {tab === "sources" ? <SourcesView /> : tab === "studio" ? <StudioView /> : <NotebookOverview />}
          </div>
        </main>
        <Companion />
      </div>
      <AddSourceDialog
        notebookId={notebook.id}
        open={addSourceOpen}
        onOpenChange={setAddSourceOpen}
      />
      <SourceReader notebookId={notebook.id} reading={reading} onClose={closeReader} />
      <ToolDialog
        notebookId={notebook.id}
        toolId={activeTool}
        initialSourceIds={toolSources}
        onClose={closeTool}
      />
      <OutputActionDialogs />
      <ConversationActionDialogs />
    </div>
  );
}

function NotebookNotFound() {
  const { t } = useTranslation("workspace");
  return (
    <main className="grid h-full place-items-center p-6">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold">{t("notFound.title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("notFound.body")}</p>
        <StudyReturnLinks className="mt-4" />
        <Link to={routes.home} className={buttonVariants({ className: "mt-6" })}>
          {t("notFound.action")}
        </Link>
      </div>
    </main>
  );
}
