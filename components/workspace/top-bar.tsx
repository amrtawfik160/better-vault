import { Add01Icon, LayoutRightIcon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { SidebarMenuButton } from "@/components/shell/sidebar-state";
import { useSources } from "@/lib/db/sources";
import { selectedTextSource } from "@/lib/db/source-text";
import { NotebookMenu } from "./notebook-menu";
import { useWorkspace } from "./workspace-context";

/**
 * The notebook's one header: the sidebar's menu button on phones, the
 * notebook's name with its menu, then Add, Practise this (the page's one
 * filled button, with its reason) and the companion's toggle. The app sidebar
 * beside it holds the way back to the notebooks and Settings.
 */
export function TopBar() {
  const { t } = useTranslation("workspace");
  const {
    notebook,
    settingsOpen,
    settingsPage,
    setSettingsOpen,
    setAddSourceOpen,
    companion,
    setCompanion,
  } = useWorkspace();
  const sources = useSources(notebook.id);
  const readable = sources?.filter(selectedTextSource).length ?? 0;
  const practising = companion === "practise";
  const reason = readable
    ? t("header.practiseReason", { count: readable })
    : t("header.needsMaterial");

  return (
    <header
      data-window-bar
      className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2 sm:px-4"
    >
      {/* Settings opens from the sidebar; this sheet is the one the page's own links (Add a key…) open. */}
      <SettingsSheet
        open={settingsOpen}
        page={settingsPage}
        onOpenChange={setSettingsOpen}
        trigger={<button type="button" hidden aria-hidden tabIndex={-1} />}
      />
      <SidebarMenuButton className="-ms-2" />
      <nav
        aria-label={t("header.breadcrumb")}
        className="flex min-w-0 flex-1 items-center gap-1 text-sm"
      >
        <div className="min-w-0">
          <NotebookMenu />
        </div>
      </nav>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setAddSourceOpen(true)}>
          <Icon icon={Add01Icon} size={16} />
          <span className="max-sm:sr-only">{t("header.add")}</span>
        </Button>
        <Button
          size="sm"
          // While the Practise tab is open, its Start is the filled button.
          variant={practising ? "outline" : "default"}
          disabled={!readable}
          title={reason}
          aria-describedby="practise-reason"
          onClick={() => setCompanion("practise")}
        >
          {t("header.practise")}
        </Button>
        <span id="practise-reason" className="hidden text-xs text-muted-foreground lg:inline">
          {reason}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("header.companion")}
          aria-expanded={companion !== null}
          aria-controls="companion"
          className={companion !== null ? "bg-accent" : undefined}
          onClick={() => setCompanion(companion ? null : "ask")}
        >
          <Icon icon={LayoutRightIcon} size={16} />
        </Button>
      </div>
    </header>
  );
}
