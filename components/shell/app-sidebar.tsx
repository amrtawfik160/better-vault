import {
  Add01Icon,
  ArrowRight01Icon,
  BotIcon,
  Books01Icon,
  Calendar03Icon,
  Cancel01Icon,
  Clock01Icon,
  Folder01Icon,
  MagicWand01Icon,
  Note01Icon,
  PinIcon,
  RepeatIcon,
  Settings01Icon,
  SidebarLeftIcon,
  Sun03Icon,
  Target02Icon,
} from "@hugeicons/core-free-icons";
import {
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { Avatar } from "@/components/account/avatar";
import { FOLDER_DRAG, NOTEBOOK_DRAG, useDropTarget } from "@/components/home/home-cards";
import { useVaultName } from "@/components/home/vault-name";
import { Icon, type IconSvgElement } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Sheet } from "@/components/panelui/sheet";
import { Tooltip } from "@/components/panelui/tooltip";
import { SettingsSheet, type SettingsPage } from "@/components/settings/settings-sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAccount } from "@/lib/account/account";
import { moveFolder, useFolders } from "@/lib/db/folders";
import { updateNotebook, useNotebooks } from "@/lib/db/notebooks";
import { useProfile } from "@/lib/db/profile";
import type { Folder, Notebook } from "@/lib/db/types";
import { currentVaultId, setCurrentVault, useCurrentVault, useVaults, vaultOf } from "@/lib/db/vaults";
import { notebookIcon } from "@/lib/notebooks/icons";
import { routes } from "@/lib/routes";
import { studyHref } from "@/lib/study/links";
import { cn } from "@/lib/utils";
import { AddMaterial } from "./add-material";
import {
  activeNavItem,
  afterVaultSwitch,
  buildNotebookTree,
  foldersAbove,
  isActive,
  pinnedNotebooks,
  type NavItem,
  type TreeNode,
} from "./nav-model";
import { useSidebar } from "./sidebar-state";
import { useVaultStats } from "./vault-stats";
import { VaultDialogs, VaultSwitcher } from "./vault-switcher";

const openFoldersKey = "better-vault:sidebar-folders";
const toolsKey = "better-vault:sidebar-tools";

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
}

export interface AppSidebarProps {
  /**
   * The notebook the page shows, on the notebook page. Its row is marked as
   * the current page, the tree opens down to it, its vault is the one shown,
   * and Add offers it first.
   */
  notebookId?: string;
}

/**
 * The app-wide sidebar: the vault switcher, Add, Study (Today, Practice,
 * Review, Library), Notebooks (its heading opens the notebooks list; Notes and
 * the notebook tree with folders below it), Tools (Calendar, Bot, Skills; the
 * group can be folded away), and Account and Settings at the foot.
 *
 * It is drawn in full from 1280px, as an icon rail between 768 and 1280px or
 * when collapsed, and in a drawer on phones, opened from the page header's
 * `SidebarMenuButton`. It must sit inside a `SidebarProvider`. It reads the
 * page from the URL, so it needs no other props on the home page.
 */
export function AppSidebar({ notebookId }: AppSidebarProps) {
  const { t } = useTranslation("shell");
  const { layout, drawerOpen, setDrawerOpen, adding, setAdding } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const vaultName = useVaultName();
  const vaults = useVaults();
  const selectedVault = useCurrentVault(vaults);
  const allNotebooks = useNotebooks();
  const allFolders = useFolders();
  const params = new URLSearchParams(location.search);
  // Study shows the vault its link names; the notebook page, the notebook's own vault.
  const linkedVault = params.get("view") === "study" ? params.get("vault") : null;
  const pageNotebook = notebookId ? allNotebooks?.find(({ id }) => id === notebookId) : undefined;
  const vaultId = pageNotebook
    ? vaultOf(pageNotebook)
    : linkedVault && vaults?.some(({ id }) => id === linkedVault)
      ? linkedVault
      : selectedVault;
  const vault = vaults?.find(({ id }) => id === vaultId);
  const stats = useVaultStats(vaults, vaultId);
  const [settings, setSettings] = useState<{ open: boolean; page: SettingsPage | null }>({
    open: false,
    page: null,
  });

  // Choosing a row in the drawer takes you there and closes it.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.key, setDrawerOpen]);

  const notebooks = useMemo(
    () => (allNotebooks ?? []).filter((notebook) => vaultOf(notebook) === vaultId),
    [allNotebooks, vaultId],
  );
  const folders = useMemo(
    () => (allFolders ?? []).filter((folder) => vaultOf(folder) === vaultId),
    [allFolders, vaultId],
  );

  function switchVault(id: string, name?: string) {
    // Undo goes back to the saved vault and to the page the switch left.
    const previous = currentVaultId();
    const back = `${location.pathname}${location.search}`;
    setCurrentVault(id);
    const next = afterVaultSwitch(location.pathname, location.search);
    if (next) navigate(next);
    const chosen = vaults?.find((each) => each.id === id);
    toast(t("vault.switched", { name: chosen ? vaultName(chosen) : (name ?? "") }), {
      action: {
        label: t("vault.undo"),
        onClick: () => {
          setCurrentVault(previous);
          navigate(back);
        },
      },
    });
  }

  // The vault dialogs are drawn outside the drawer, so it closes first.
  const [vaultDialog, setVaultDialog] = useState<"new" | "manage" | null>(null);
  const openVaultDialog = (which: "new" | "manage") => {
    setDrawerOpen(false);
    setVaultDialog(which);
  };

  // A dialog or sheet opened from the drawer is drawn outside it, so the drawer closes first.
  const openSettings = (page: SettingsPage | null) => {
    setDrawerOpen(false);
    setSettings({ open: true, page });
  };
  const openAdd = () => {
    setDrawerOpen(false);
    setAdding(true);
  };

  const body = (rail: boolean, inDrawer: boolean) =>
    vaults && vault ? (
      <SidebarBody
        rail={rail}
        inDrawer={inDrawer}
        vaults={vaults}
        vault={vault}
        stats={stats}
        notebooks={notebooks}
        folders={folders}
        active={activeNavItem(location.pathname, location.search)}
        openNotebook={notebookId}
        onSwitch={switchVault}
        onNewVault={() => openVaultDialog("new")}
        onManageVaults={() => openVaultDialog("manage")}
        onAdd={openAdd}
        onSettings={openSettings}
      />
    ) : null;

  return (
    <>
      {layout === "drawer" ? null : (
        <nav
          aria-label={t("nav.label")}
          className={cn(
            "flex h-full shrink-0 flex-col bg-background",
            layout === "rail" ? "w-16 px-2 pb-2" : "w-58 ps-3 pe-2 pb-2",
          )}
        >
          {body(layout === "rail", false)}
        </nav>
      )}
      <Sheet side="left" open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Sheet.Content
          id="app-sidebar-drawer"
          detached={false}
          showClose={false}
          // Opened from the header's menu button, not a trigger of its own: focus goes back there.
          finalFocus={() =>
            document.querySelector<HTMLElement>('[aria-controls="app-sidebar-drawer"]') ?? true
          }
          className="w-[min(304px,86vw)] bg-card"
        >
          <nav aria-label={t("nav.label")} className="flex h-full min-h-0 flex-col px-2 pb-2">
            {body(false, true)}
          </nav>
        </Sheet.Content>
      </Sheet>
      {vaults && vault ? (
        <VaultDialogs
          vaults={vaults}
          current={vault}
          stats={stats}
          creating={vaultDialog === "new"}
          onCreatingChange={(open) => setVaultDialog(open ? "new" : null)}
          managing={vaultDialog === "manage"}
          onManagingChange={(open) => setVaultDialog(open ? "manage" : null)}
          onSwitch={switchVault}
        />
      ) : null}
      {vaults && vault ? (
        <AddMaterial
          open={adding}
          onOpenChange={setAdding}
          notebooks={notebooks}
          vaultId={vaultId}
          notebookId={notebookId}
        />
      ) : null}
      <SettingsSheet
        open={settings.open}
        page={settings.page}
        onOpenChange={(open) => setSettings((state) => ({ ...state, open }))}
        // The sidebar's own buttons open it; this trigger is never shown.
        trigger={<button type="button" hidden aria-hidden tabIndex={-1} />}
      />
    </>
  );
}

const rowClass =
  "flex h-8 min-w-0 items-center gap-3 rounded-md px-2 text-start text-[0.8125rem] leading-5 outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40 max-md:h-11";
const idleRow = "text-muted-foreground hover:bg-foreground/5 hover:text-foreground";
const currentRow = "bg-muted font-medium text-foreground inset-ring inset-ring-border";
const railRow = "mx-auto size-10 shrink-0 justify-center gap-0 px-0";
const headingClass = "px-2 pt-4 pb-1 text-xs font-medium text-muted-foreground";

/** In the rail, a row's name is a tooltip; elsewhere the row is left as it is. */
function RailTip({ rail, label, children }: { rail: boolean; label: string; children: ReactElement }) {
  if (!rail) return children;
  return (
    <Tooltip>
      <Tooltip.Trigger render={children} />
      <Tooltip.Content side="inline-end">{label}</Tooltip.Content>
    </Tooltip>
  );
}

function SidebarBody({
  rail,
  inDrawer,
  vaults,
  vault,
  stats,
  notebooks,
  folders,
  active,
  openNotebook,
  onSwitch,
  onNewVault,
  onManageVaults,
  onAdd,
  onSettings,
}: {
  rail: boolean;
  inDrawer: boolean;
  vaults: NonNullable<ReturnType<typeof useVaults>>;
  vault: NonNullable<ReturnType<typeof useVaults>>[number];
  stats: ReturnType<typeof useVaultStats>;
  notebooks: Notebook[];
  folders: Folder[];
  active: NavItem | null;
  openNotebook?: string;
  onSwitch: (id: string) => void;
  onNewVault: () => void;
  onManageVaults: () => void;
  onAdd: () => void;
  onSettings: (page: SettingsPage | null) => void;
}) {
  const { t } = useTranslation("shell");
  const { layout, wide, collapsed, setCollapsed, setDrawerOpen } = useSidebar();
  const profile = useProfile();
  const account = useAccount();
  const [toolsShown, setToolsShown] = useState(() => readStored(toolsKey) !== "hidden");
  const due = stats?.get(vault.id)?.due ?? 0;
  const accountName = profile?.name || account?.user.name || t("nav.account");

  const link = (item: NavItem, to: string, icon: IconSvgElement, label: string, extra?: ReactNode, aria?: string) => {
    const current = isActive(active, item);
    return (
      <RailTip key={item.kind} rail={rail} label={aria ?? label}>
        <Link
          to={to}
          aria-current={current ? "page" : undefined}
          aria-label={aria}
          className={cn(rowClass, current ? currentRow : idleRow, rail && railRow)}
        >
          <Icon icon={icon} size={16} strokeWidth={1.5} />
          <span className={cn("min-w-0 flex-1 truncate", rail && "sr-only")}>{label}</span>
          {rail ? null : extra}
        </Link>
      </RailTip>
    );
  };

  return (
    <>
      {/* The window's buttons sit above this strip on macOS (`data-window-bar`). */}
      <div
        data-window-bar
        className={cn("flex min-h-13 shrink-0 items-center gap-1", rail && "justify-center")}
      >
        <VaultSwitcher vaults={vaults} current={vault} stats={stats}
          rail={rail}
          onSwitch={onSwitch}
          onNew={onNewVault}
          onManage={onManageVaults}
        />
        {inDrawer ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("nav.closeMenu")}
            onClick={() => setDrawerOpen(false)}
            className="text-muted-foreground max-md:size-11"
          >
            <Icon icon={Cancel01Icon} size={16} strokeWidth={1.5} />
          </Button>
        ) : layout === "full" ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("nav.collapse")}
            title={t("nav.collapse")}
            onClick={() => setCollapsed(true)}
            className="text-muted-foreground"
          >
            <Icon icon={SidebarLeftIcon} size={16} strokeWidth={1.5} className="rtl:-scale-x-100" />
          </Button>
        ) : null}
      </div>

      <RailTip rail={rail} label={t("nav.add")}>
        <Button
          variant="outline"
          size="sm"
          onClick={onAdd}
          aria-label={t("nav.addLabel")}
          className={cn(
            rowClass,
            "mt-1 justify-start border-input bg-transparent pe-3 font-medium text-foreground shadow-none dark:bg-transparent",
            rail && railRow,
          )}
        >
          <Icon icon={Add01Icon} size={16} strokeWidth={1.5} />
          {rail ? null : (
            <>
              <span className="flex-1 ps-1">{t("nav.add")}</span>
              <span className="text-xs font-normal text-muted-foreground">{t("nav.addHint")}</span>
            </>
          )}
        </Button>
      </RailTip>

      <ScrollArea className="-mx-1 mt-2 min-h-0 flex-1">
        <div className={cn("flex flex-col gap-0.5 px-1 pb-2", rail && "gap-1 pt-2")}>
          <Heading rail={rail}>{t("nav.study")}</Heading>
          {link({ kind: "today" }, studyHref("today"), Sun03Icon, t("nav.today"))}
          {link({ kind: "practice" }, studyHref("practice"), Target02Icon, t("nav.practice"))}
          {link(
            { kind: "review" },
            studyHref("review"),
            RepeatIcon,
            t("nav.review"),
            due ? (
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {t("nav.due", { count: due })}
              </span>
            ) : null,
            due ? t("nav.reviewDue", { count: due }) : undefined,
          )}
          {link({ kind: "library" }, studyHref("library"), Books01Icon, t("nav.library"))}

          <NotebooksHeading rail={rail} current={active?.kind === "notebooks"} folders={folders} />
          {link({ kind: "recent" }, `${routes.home}?view=recents`, Clock01Icon, t("nav.recent"))}
          {link({ kind: "notes" }, `${routes.home}?view=notes`, Note01Icon, t("nav.notes"))}
          <PinnedNotebooks rail={rail} notebooks={notebooks} active={active} openNotebook={openNotebook} />
          <NotebookTree
            rail={rail}
            folders={folders}
            notebooks={notebooks}
            active={active}
            openNotebook={openNotebook}
          />

          {rail || toolsShown ? (
            <>
              {rail ? (
                <Heading rail>{t("nav.tools")}</Heading>
              ) : (
                <ToolsHeading
                  shown
                  onToggle={() => {
                    setToolsShown(false);
                    store(toolsKey, "hidden");
                  }}
                />
              )}
              {link({ kind: "calendar" }, `${routes.home}?view=calendar`, Calendar03Icon, t("nav.calendar"))}
              {link({ kind: "bot" }, `${routes.home}?view=bot`, BotIcon, t("nav.bot"))}
              {link({ kind: "skills" }, `${routes.home}?view=skills`, MagicWand01Icon, t("nav.skills"))}
            </>
          ) : (
            <ToolsHeading
              shown={false}
              onToggle={() => {
                setToolsShown(true);
                store(toolsKey, "shown");
              }}
            />
          )}
        </div>
      </ScrollArea>

      <div
        className={cn(
          "flex shrink-0 items-center gap-1 border-t pt-2",
          rail && "flex-col",
        )}
      >
        {rail && wide && collapsed ? (
          <RailTip rail label={t("nav.expand")}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("nav.expand")}
              onClick={() => setCollapsed(false)}
              className={cn(rowClass, idleRow, railRow)}
            >
              <Icon icon={SidebarLeftIcon} size={16} strokeWidth={1.5} className="rtl:-scale-x-100" />
            </Button>
          </RailTip>
        ) : null}
        <RailTip rail={rail} label={accountName}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSettings("account")}
            aria-label={rail ? accountName : undefined}
            // In the rail the foot is a column: the row keeps its 40px instead of sharing the height.
            className={cn(rowClass, idleRow, "justify-start font-normal", rail ? railRow : "flex-1")}
          >
            <Avatar
              profile={profile && { ...profile, avatar: profile.avatar ?? account?.user.image ?? null }}
              size={20}
            />
            {rail ? null : <span className="min-w-0 flex-1 truncate text-start">{accountName}</span>}
          </Button>
        </RailTip>
        <RailTip rail={rail} label={t("nav.settings")}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onSettings(null)}
            aria-label={t("nav.settings")}
            title={rail ? undefined : t("nav.settings")}
            className={cn(
              rowClass,
              idleRow,
              rail ? railRow : "size-8 shrink-0 justify-center px-0 max-md:size-11",
            )}
          >
            <Icon icon={Settings01Icon} size={16} strokeWidth={1.5} />
          </Button>
        </RailTip>
      </div>
    </>
  );
}

function Heading({ rail, children }: { rail: boolean; children: ReactNode }) {
  // The rail has no room for words: a hairline stands between its groups instead.
  if (rail) return <hr aria-hidden className="mx-auto my-1 w-6 border-border first:hidden" />;
  return <p className={cn(headingClass, "first:pt-1")}>{children}</p>;
}

/** Moves a notebook or folder dropped on a sidebar row into `target` (null: the top level). */
async function dropInto(event: DragEvent, target: string | null, folders: Folder[]) {
  const notebookId = event.dataTransfer.getData(NOTEBOOK_DRAG);
  const folderId = event.dataTransfer.getData(FOLDER_DRAG);
  if (notebookId) await updateNotebook(notebookId, { folderId: target });
  if (folderId && folderId !== target) await moveFolder(folderId, target, folders);
}

/** "Notebooks": the group's heading, and the link to the notebooks list. Dropping on it moves to the top level. */
function NotebooksHeading({ rail, current, folders }: { rail: boolean; current: boolean; folders: Folder[] }) {
  const { t } = useTranslation("shell");
  const drop = useDropTarget((event) => void dropInto(event, null, folders));
  if (rail)
    return (
      <>
        <Heading rail>{t("nav.notebooks")}</Heading>
        <RailTip rail label={t("nav.allNotebooks")}>
          <Link
            to={routes.home}
            aria-current={current ? "page" : undefined}
            aria-label={t("nav.allNotebooks")}
            {...drop.props}
            className={cn(rowClass, current ? currentRow : idleRow, railRow, drop.over && "ring-1 ring-ring")}
          >
            <Icon icon={Folder01Icon} size={16} strokeWidth={1.5} />
          </Link>
        </RailTip>
      </>
    );
  return (
    <Link
      to={routes.home}
      aria-current={current ? "page" : undefined}
      title={t("nav.allNotebooks")}
      {...drop.props}
      className={cn(
        headingClass,
        "mt-3 flex items-center rounded-md pt-1 outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 max-md:min-h-11 max-md:py-0",
        current && "text-foreground",
        drop.over && "bg-muted ring-1 ring-ring",
      )}
    >
      {t("nav.notebooks")}
    </Link>
  );
}

function ToolsHeading({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const { t } = useTranslation("shell");
  return (
    <Button
      variant="ghost"
      aria-expanded={shown}
      title={shown ? t("nav.hideTools") : t("nav.showTools")}
      onClick={onToggle}
      className={cn(
        headingClass,
        "group/tools mt-3 h-auto justify-start gap-1 rounded-md pt-1 text-start hover:not-disabled:bg-transparent hover:not-disabled:text-foreground active:not-disabled:scale-100 max-md:min-h-11 max-md:py-0",
      )}
    >
      {t("nav.tools")}
      <Icon
        icon={ArrowRight01Icon}
        size={12}
        strokeWidth={2}
        className={cn(
          "opacity-0 transition-[opacity,rotate] group-hover/tools:opacity-100 group-focus-visible/tools:opacity-100 rtl:-scale-x-100",
          shown && "rotate-90",
          !shown && "opacity-100",
        )}
      />
    </Button>
  );
}

function readOpenFolders(): Set<string> {
  try {
    const saved: unknown = JSON.parse(readStored(openFoldersKey) ?? "[]");
    return new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

/** Every pinned notebook of the vault, also those inside folders. */
function PinnedNotebooks({
  rail,
  notebooks,
  active,
  openNotebook,
}: {
  rail: boolean;
  notebooks: Notebook[];
  active: NavItem | null;
  openNotebook?: string;
}) {
  const { t } = useTranslation("shell");
  const pinned = useMemo(() => pinnedNotebooks(notebooks), [notebooks]);
  if (pinned.length === 0) return null;
  const current = active?.kind === "notebook" ? active.id : openNotebook;
  return (
    <>
      <Heading rail={rail}>{t("nav.pinned")}</Heading>
      {pinned.map((notebook) => (
        <NotebookRow key={notebook.id} notebook={notebook} depth={0} rail={rail} current={current === notebook.id} />
      ))}
    </>
  );
}

/** The vault's folders and notebooks. Folders fold; the tree opens down to the notebook shown. */
function NotebookTree({
  rail,
  folders,
  notebooks,
  active,
  openNotebook,
}: {
  rail: boolean;
  folders: Folder[];
  notebooks: Notebook[];
  active: NavItem | null;
  openNotebook?: string;
}) {
  const { t } = useTranslation("shell");
  const [open, setOpen] = useState(readOpenFolders);
  const tree = useMemo(() => buildNotebookTree(folders, notebooks), [folders, notebooks]);
  const current = active?.kind === "notebook" ? active.id : openNotebook;
  const above = useMemo(
    () => new Set(current ? foldersAbove(current, folders, notebooks) : []),
    [current, folders, notebooks],
  );

  // Folders opened by hand stay open; the ones above the notebook shown open by themselves until folded.
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const expanded = (id: string) => open.has(id) || (above.has(id) && !folded.has(id));
  const toggle = (id: string) => {
    const opening = !expanded(id);
    setOpen((state) => {
      const next = new Set(state);
      if (opening) next.add(id);
      else next.delete(id);
      store(openFoldersKey, JSON.stringify([...next]));
      return next;
    });
    setFolded((state) => {
      const next = new Set(state);
      if (opening) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!rail && tree.length === 0)
    return <p className="px-2 py-1 text-xs text-muted-foreground">{t("nav.noNotebooks")}</p>;

  const render = (nodes: TreeNode[]): ReactNode =>
    nodes.map((node) =>
      node.kind === "folder" ? (
        <FolderRow
          key={node.folder.id}
          node={node}
          rail={rail}
          expanded={expanded(node.folder.id)}
          folders={folders}
          onToggle={() => toggle(node.folder.id)}
        >
          {render(node.children)}
        </FolderRow>
      ) : (
        <NotebookRow
          key={node.notebook.id}
          notebook={node.notebook}
          depth={rail ? 0 : node.depth}
          rail={rail}
          current={current === node.notebook.id}
        />
      ),
    );
  return <>{render(tree)}</>;
}

function FolderRow({
  node,
  rail,
  expanded,
  folders,
  onToggle,
  children,
}: {
  node: Extract<TreeNode, { kind: "folder" }>;
  rail: boolean;
  expanded: boolean;
  folders: Folder[];
  onToggle: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation("shell");
  const { folder, depth } = node;
  const drop = useDropTarget((event) => void dropInto(event, folder.id, folders));
  return (
    <>
      <RailTip rail={rail} label={folder.name}>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-label={rail ? folder.name : undefined}
          title={rail ? undefined : expanded ? t("nav.foldFolder") : t("nav.unfoldFolder")}
          onClick={onToggle}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(FOLDER_DRAG, folder.id);
            event.dataTransfer.effectAllowed = "move";
          }}
          {...drop.props}
          style={rail ? undefined : { paddingInlineStart: `${0.5 + depth * 0.75}rem` }}
          className={cn(
            rowClass,
            idleRow,
            "justify-start gap-2 font-normal",
            rail && railRow,
            drop.over && "bg-muted ring-1 ring-ring",
          )}
        >
          {rail ? null : (
            <Icon
              icon={ArrowRight01Icon}
              size={12}
              strokeWidth={2}
              className={cn("-me-1 transition-[rotate] duration-150 rtl:-scale-x-100", expanded && "rotate-90")}
            />
          )}
          <Icon icon={Folder01Icon} size={16} strokeWidth={1.5} />
          <span className={cn("min-w-0 flex-1 truncate text-start", rail && "sr-only")}>{folder.name}</span>
        </Button>
      </RailTip>
      {expanded ? children : null}
    </>
  );
}

function NotebookRow({
  notebook,
  depth,
  rail,
  current,
}: {
  notebook: Notebook;
  depth: number;
  rail: boolean;
  current: boolean;
}) {
  const { t } = useTranslation("shell");
  return (
    <RailTip rail={rail} label={notebook.title}>
      <Link
        to={routes.notebook(notebook.id)}
        aria-current={current ? "page" : undefined}
        aria-label={rail ? notebook.title : undefined}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(NOTEBOOK_DRAG, notebook.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        style={rail ? undefined : { paddingInlineStart: `${0.5 + depth * 0.75 + (depth ? 0.75 : 0)}rem` }}
        className={cn(rowClass, current ? currentRow : idleRow, rail && railRow)}
      >
        <Icon icon={notebookIcon(notebook.icon)} size={16} strokeWidth={1.5} />
        <span className={cn("min-w-0 flex-1 truncate", rail && "sr-only")} dir="auto">
          {notebook.title}
        </span>
        {notebook.pinned && !rail ? (
          <>
            <Icon icon={PinIcon} size={12} strokeWidth={1.5} className="text-muted-foreground" />
            <span className="sr-only">{t("nav.pinned")}</span>
          </>
        ) : null}
      </Link>
    </RailTip>
  );
}
