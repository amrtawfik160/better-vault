import { createContext, useContext, useEffect, useState, type ComponentProps, type DragEvent } from "react";
import { Outlet, useMatch } from "react-router";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { AppSidebar } from "./app-sidebar";
import { SidebarProvider } from "./sidebar-state";

const BareContext = createContext<(bare: boolean) => void>(() => {});

/** A page that takes the whole window (a reader in focus) asks the frame to drop the sidebar and margins. */
export function useBareFrame(bare: boolean) {
  const setBare = useContext(BareContext);
  useEffect(() => {
    setBare(bare);
    return () => setBare(false);
  }, [bare, setBare]);
}

/** A file dropped beside a drop zone must not make the browser open it and leave the app. */
function keepFilesInApp(event: DragEvent) {
  if (event.dataTransfer.types.includes("Files")) event.preventDefault();
}

/**
 * The frame of every page of the app, as a layout route: the app sidebar at
 * the inline start and the page beside it. Being one route above the pages,
 * the sidebar keeps its state (folded folders, scroll) as you move between
 * them. Pages draw their own desk (`Desk`, or a card of their own) inside,
 * and put a `SidebarMenuButton` in their header for phones.
 */
export function AppFrame() {
  const [bare, setBare] = useState(false);
  const notebookId = useMatch(routes.notebook(":id"))?.params.id;
  return (
    <SidebarProvider>
      <BareContext.Provider value={setBare}>
        <div className="flex h-full bg-background" onDragOver={keepFilesInApp} onDrop={keepFilesInApp}>
          {bare ? null : <AppSidebar notebookId={notebookId} />}
          <div className={cn("flex min-w-0 flex-1 flex-col", !bare && "md:py-2 md:pe-2")}>
            <Outlet />
          </div>
        </div>
      </BareContext.Provider>
    </SidebarProvider>
  );
}

/** The page's surface beside the sidebar: a card with a hairline edge, meeting the screen edges on phones. */
export function Desk({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card md:rounded-xl md:border",
        className,
      )}
      {...props}
    />
  );
}
