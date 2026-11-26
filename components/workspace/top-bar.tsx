import { Add01Icon, LayoutRightIcon } from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Tooltip } from "@/components/panelui/tooltip";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { SidebarMenuButton } from "@/components/shell/sidebar-state";
import { useSources } from "@/lib/db/sources";
import { selectedTextSource } from "@/lib/db/source-text";
import { cn } from "@/lib/utils";
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
        {/* On phones Add lives in the sidebar drawer and the prompt's menu, so the name keeps room to be read. */}
        <Button
          variant="outline"
          size="sm"
          className="max-sm:hidden"
          onClick={() => setAddSourceOpen(true)}
        >
          <Icon icon={Add01Icon} size={16} />
          {t("header.add")}
        </Button>
        {/*
          Practise this carries its reason under the label from 1280px; narrower,
          the reason is a tooltip and stays the button's description. Without
          material it stays focusable and says why (aria-disabled, outline).
        */}
        <Tooltip>
          <Tooltip.Trigger
            render={
              <Button
                size="sm"
                // While the Practise tab is open, its Start is the filled button.
                variant={practising || !readable ? "outline" : "default"}
                aria-disabled={!readable || undefined}
                aria-describedby="practise-reason"
                className={cn(
                  "max-sm:h-11 xl:h-auto xl:min-h-10 xl:flex-col xl:items-start xl:gap-0 xl:rounded-xl xl:py-1 xl:ps-3 xl:pe-4",
                  !readable &&
                    "cursor-not-allowed text-muted-foreground shadow-none hover:not-disabled:bg-background hover:not-disabled:text-muted-foreground active:not-disabled:scale-100 dark:hover:not-disabled:bg-input/30",
                )}
                onClick={() => {
                  if (readable) setCompanion("practise");
                }}
              >
                <span className="xl:text-[0.8125rem] xl:leading-4 xl:font-semibold">
                  {t("header.practise")}
                </span>
                <span
                  id="practise-reason"
                  className="sr-only text-xs leading-4 font-normal opacity-75 xl:not-sr-only"
                >
                  {reason}
                </span>
              </Button>
            }
          />
          <Tooltip.Content className="xl:hidden">{reason}</Tooltip.Content>
        </Tooltip>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("header.companion")}
          aria-expanded={companion !== null}
          aria-controls="companion"
          className={cn("max-sm:size-11", companion !== null && "bg-accent")}
          onClick={() => setCompanion(companion ? null : "ask")}
        >
          <Icon icon={LayoutRightIcon} size={16} />
        </Button>
      </div>
    </header>
  );
}
