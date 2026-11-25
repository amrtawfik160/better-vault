import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { AppSidebar, type AppSidebarProps } from "./app-sidebar";
import { SidebarProvider } from "./sidebar-state";

/**
 * A page of the app: the app sidebar at the inline start and the page beside
 * it. Pages draw their own desk (`Desk`, or a card of their own) inside, and
 * put a `SidebarMenuButton` in their header for phones; both, and anything
 * else that calls `useSidebar`, must be inside this frame. Other props go to
 * the outer element (drop handlers, for example).
 */
export function AppFrame({
  notebookId,
  bare = false,
  className,
  children,
  ...props
}: AppSidebarProps &
  ComponentProps<"div"> & {
    /** The page takes the whole window (a reader in focus): no sidebar, no margins. */
    bare?: boolean;
  }) {
  return (
    <SidebarProvider>
      <div className={cn("flex h-full bg-background", className)} {...props}>
        {bare ? null : <AppSidebar notebookId={notebookId} />}
        <div className={cn("flex min-w-0 flex-1 flex-col", !bare && "md:py-2 md:pe-2")}>{children}</div>
      </div>
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
