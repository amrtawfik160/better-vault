import {
  Add01Icon,
  ArrowRight01Icon,
  LayoutRightIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { useSources } from "@/lib/db/sources";
import { selectedTextSource } from "@/lib/db/source-text";
import { routes } from "@/lib/routes";
import { NotebookMenu } from "./notebook-menu";
import { useWorkspace } from "./workspace-context";

/**
 * The notebook's one header: Settings and the way back to the notebooks, the
 * notebook's name with its menu, then Add, Practise this (the page's one
 * filled button, with its reason) and the companion's toggle.
 */
export function TopBar() {
  const { t } = useTranslation("workspace");
  const { t: tSettings } = useTranslation("settings");
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
      <SettingsSheet
        open={settingsOpen}
        page={settingsPage}
        onOpenChange={setSettingsOpen}
        trigger={
          <Button variant="ghost" size="icon-sm" aria-label={tSettings("title")} title={tSettings("title")}>
            <Icon icon={Settings01Icon} size={16} />
          </Button>
        }
      />
      <nav aria-label={t("header.breadcrumb")} className="flex min-w-0 flex-1 items-center gap-1 text-sm">
        <Link
          to={routes.home}
          className="shrink-0 rounded-md px-1.5 py-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          {t("header.notebooks")}
        </Link>
        <Icon icon={ArrowRight01Icon} size={14} className="shrink-0 text-muted-foreground rtl:rotate-180" />
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
