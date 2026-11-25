import { Menu01Icon } from "@hugeicons/core-free-icons";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { cn } from "@/lib/utils";
import { sidebarLayout, type SidebarLayout } from "./nav-model";

const collapsedKey = "better-vault:sidebar-collapsed";
const mediumQuery = "(min-width: 768px)";
const wideQuery = "(min-width: 1280px)";

function useMedia(query: string) {
  return useSyncExternalStore(
    (change) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", change);
      return () => list.removeEventListener("change", change);
    },
    () => window.matchMedia(query).matches,
    () => true,
  );
}

function savedCollapsed() {
  try {
    return localStorage.getItem(collapsedKey) === "1";
  } catch {
    return false;
  }
}

interface SidebarState {
  layout: SidebarLayout;
  /** At least 1280px wide, where the sidebar can be expanded in full. */
  wide: boolean;
  /** Collapsed to icons by choice (wide screens only). */
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  /** The phone drawer. */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  /** The sidebar's Add box. Pages open it too (their own Add buttons), so it is shared here. */
  adding: boolean;
  setAdding: (open: boolean) => void;
}

const SidebarContext = createContext<SidebarState | null>(null);

/**
 * Holds the app sidebar's state for one page: its layout for the window's
 * width, whether it is collapsed, and whether the phone drawer is open. The
 * page's header puts a `SidebarMenuButton` in it to open the drawer.
 */
export function SidebarProvider({ children }: { children: ReactNode }) {
  const medium = useMedia(mediumQuery);
  const wide = useMedia(wideQuery);
  const [collapsed, setCollapsedState] = useState(savedCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    try {
      localStorage.setItem(collapsedKey, next ? "1" : "0");
    } catch {
      // Storage can be blocked; the choice then lasts for this page only.
    }
  }, []);
  const layout = sidebarLayout({ medium, wide, collapsed });
  const value = useMemo(
    () => ({
      layout,
      wide,
      collapsed,
      setCollapsed,
      drawerOpen: layout === "drawer" && drawerOpen,
      setDrawerOpen,
      adding,
      setAdding,
    }),
    [layout, wide, collapsed, setCollapsed, drawerOpen, adding],
  );
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarState {
  const state = useContext(SidebarContext);
  if (!state) throw new Error("The app sidebar must be inside a <SidebarProvider>.");
  return state;
}

/** The header's menu button that opens the sidebar's drawer on phones; hidden on wider screens. */
export function SidebarMenuButton({ className }: { className?: string }) {
  const { t } = useTranslation("shell");
  const { drawerOpen, setDrawerOpen } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t("nav.openMenu")}
      aria-expanded={drawerOpen}
      aria-controls="app-sidebar-drawer"
      onClick={() => setDrawerOpen(true)}
      className={cn("text-muted-foreground max-md:size-11 md:hidden", className)}
    >
      <Icon icon={Menu01Icon} size={18} strokeWidth={1.5} />
    </Button>
  );
}
