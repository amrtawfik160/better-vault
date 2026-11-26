import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  Books01Icon,
  Cancel01Icon,
  FileImportIcon,
  FileUploadIcon,
  FolderAddIcon,
  GridViewIcon,
  Menu01Icon,
  MoreHorizontalIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type DragEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { MenuActions, type MenuAction } from "@/components/common/action-menu";
import { ContextMenu, ContextMenuTrigger } from "@/components/common/context-menu";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import { Menu } from "@/components/panelui/menu";
import { Desk, useBareFrame } from "@/components/shell/app-frame";
import { SidebarMenuButton, useSidebar } from "@/components/shell/sidebar-state";
import { StudyReturnLinks } from "@/components/study/study-return-links";
import { ScrollArea } from "@/components/ui/scroll-area";
import { openCommandPalette } from "@/lib/command";
import type { Folder, Notebook } from "@/lib/db/database";
import { ancestors, createFolder, moveFolder, useFolders } from "@/lib/db/folders";
import {
  createNotebook,
  updateNotebook,
  useNotebookCounts,
  useNotebooks,
} from "@/lib/db/notebooks";
import { DEFAULT_VAULT, useCurrentVault, useVaults, vaultOf } from "@/lib/db/vaults";
import { shortcutKeys } from "@/lib/platform";
import { routes } from "@/lib/routes";
import { ACCEPTED_FILES, IngestError, ingestFile } from "@/lib/sources/ingest";
import { sourceHasText } from "@/lib/db/source-text";
import { useSourceTitles } from "@/lib/db/sources";
import { useStudyBooks } from "@/lib/db/study";
import { libraryNotebookIds } from "@/lib/study/library";
import { isFocusedStudyReader, studyLocation, studySectionOf } from "@/lib/study/links";
import { studyReadingProgress } from "@/lib/study/reading-progress";
import { cn } from "@/lib/utils";
import { FirstRun } from "@/components/onboarding/first-run";
import { FolderDialog } from "./folder-dialogs";
import {
  FOLDER_DRAG,
  FolderItem,
  NOTEBOOK_DRAG,
  NotebookItem,
  isFileDrag,
  useDropTarget,
  type HomeView,
} from "./home-cards";
import { NotebookDialog } from "./notebook-dialog";
import { searchNotebooks, sortItems, titlesByNotebook, type NotebookSort } from "./notebook-list";
import { useVaultName } from "./vault-name";

/** The calendar is large; it loads the first time it is opened. */
const CalendarView = lazy(() => import("@/components/calendar/calendar-view"));
/** The Bot section loads the first time it is opened too. */
const BotView = lazy(() => import("@/components/bot/bot-view"));
const NotesWorkspace = lazy(() => import("@/components/notes/notes-workspace"));
const SkillsWorkspace = lazy(() => import("@/components/skills/skills-workspace"));
const StudyWorkspace = lazy(() => import("@/components/study/study-workspace"));

const sortKey = "better-vault:home-sort";
const viewKey = "better-vault:home-view";
const groupKey = "better-vault:home-group-library";

/**
 * What the page shows: everything in the vault (by folder), its recent
 * notebooks, a part of Study, Notes or a tool. "vault" is "all", kept for old
 * links. The sidebar reads the same `?view=` (components/shell/nav-model.ts).
 */
export type HomeSection =
  "all" | "vault" | "recents" | "calendar" | "bot" | "notes" | "skills" | "study";

const saved = <T extends string>(key: string, values: readonly T[], fallback: T): T => {
  try {
    const value = localStorage.getItem(key);
    return values.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
};

const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
};

/**
 * The home page, beside the app sidebar: the Notebooks list (folders, search,
 * sort, list or tiles), or the part of Study, Notes or the tool the sidebar
 * chose. Files dropped anywhere on the list start a notebook with them.
 */
export function NotebookHome() {
  const { t } = useTranslation("home");
  const { t: tShell } = useTranslation("shell");
  const { t: tCommon } = useTranslation();
  const { t: tNotes } = useTranslation("notes");
  const tSources = useTranslation("sources").t;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const allNotebooks = useNotebooks();
  const everyFolder = useFolders();
  const counts = useNotebookCounts();
  const studyBooks = useStudyBooks();
  const libraryIds = useMemo(
    () => libraryNotebookIds(studyBooks ?? [], counts ?? new Map(), allNotebooks ?? []),
    [studyBooks, counts, allNotebooks],
  );
  const vaults = useVaults();
  const selectedVault = useCurrentVault(vaults);
  const studyVault = params.get("view") === "study" ? params.get("vault") : null;
  const vaultId =
    studyVault && vaults?.some(({ id }) => id === studyVault) ? studyVault : selectedVault;
  const vault = vaults?.find((each) => each.id === vaultId);
  const vaultName = useVaultName();
  const notebooks = useMemo(
    () => allNotebooks?.filter((notebook) => vaultOf(notebook) === vaultId),
    [allNotebooks, vaultId],
  );
  const folders = useMemo(
    () => (everyFolder ?? []).filter((folder) => vaultOf(folder) === vaultId),
    [everyFolder, vaultId],
  );
  const importInput = useRef<HTMLInputElement>(null);

  const [sort, setSort] = useState<NotebookSort>(() => saved(sortKey, ["recent", "name"], "recent"));
  const [view, setView] = useState<HomeView>(() => saved(viewKey, ["grid", "list"], "list"));
  // Notebooks made for one document added in Study can sit apart, under "From your library".
  const [grouping, setGrouping] = useState(() => saved(groupKey, ["on", "off"], "on") === "on");
  // A search belongs to the list it was typed in: another vault, folder or section starts empty.
  const [search, setSearch] = useState({ scope: "", text: "" });
  const searchInput = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState<{ files: File[] } | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [fileDrag, setFileDrag] = useState(false);
  const dragDepth = useRef(0);

  const viewParam = params.get("view");
  const section: HomeSection =
    viewParam === "recents" ||
    viewParam === "calendar" ||
    viewParam === "bot" ||
    viewParam === "vault" ||
    viewParam === "notes" ||
    viewParam === "skills" ||
    viewParam === "study"
      ? viewParam
      : "all";
  const studying = section === "study";
  const studyTab = studying ? studyLocation(params).tab : undefined;
  // Collection is Review's Browse mode, so the title says Review.
  const studySection = studyTab && studySectionOf(studyTab);
  const focusedReader = isFocusedStudyReader(params);
  useBareFrame(focusedReader);
  // The calendar, bot, notes and skills supply their own header on wider screens.
  const fullPage =
    section === "calendar" || section === "bot" || section === "notes" || section === "skills";
  const panelPage = fullPage || studying;
  const listing = section === "all" || section === "vault" || section === "recents";
  const folderParam = params.get("folder");
  const current =
    listing && section !== "recents" && folderParam && folders.some((folder) => folder.id === folderParam)
      ? folderParam
      : null;
  const path = ancestors(current, folders);
  const currentFolder = path.at(-1);
  const title =
    section === "notes"
      ? tNotes("title")
      : section === "skills"
        ? tNotes("skillsTitle")
        : section === "calendar"
          ? t("calendar.title")
          : section === "bot"
            ? t("bot.title")
            : studySection
              ? t(`study.tabs.${studySection}`)
              : section === "recents"
                ? tShell("list.recentTitle")
                : (currentFolder?.name ?? tShell("list.title"));

  useEffect(() => {
    document.title = title ? `${title} · ${tCommon("appName")}` : tCommon("appName");
  }, [title, tCommon]);

  const searchScope = `${vaultId}/${current ?? ""}/${section}`;
  const query = search.scope === searchScope ? search.text : "";
  const setQuery = (text: string) => setSearch({ scope: searchScope, text });

  const sourceTitles = useSourceTitles(listing);
  const titles = useMemo(() => titlesByNotebook(sourceTitles ?? []), [sourceTitles]);
  // One quiet line per notebook: where its last-read document was left, and how far.
  const progress = useMemo(() => {
    const lastRead = new Map<string, NonNullable<typeof studyBooks>[number]>();
    for (const book of studyBooks ?? []) {
      if (!book.notebookId || book.lastReadAt === undefined) continue;
      const seen = lastRead.get(book.notebookId);
      if (!seen || (seen.lastReadAt ?? 0) < book.lastReadAt) lastRead.set(book.notebookId, book);
    }
    const lines = new Map<string, string>();
    for (const [id, book] of lastRead) {
      const percent = Math.round(studyReadingProgress(book) * 100);
      const place = book.sections[book.section]?.title;
      lines.set(id, [place, tShell("list.read", { percent })].filter(Boolean).join(" · "));
    }
    return lines;
  }, [studyBooks, tShell]);

  const chooseSort = (next: unknown) => {
    const value = next === "name" ? "name" : "recent";
    setSort(value);
    remember(sortKey, value);
  };
  const chooseView = (next: unknown) => {
    const value = next === "grid" ? "grid" : "list";
    setView(value);
    remember(viewKey, value);
  };

  // The right-click menu of the page's empty space; cards have menus of their own.
  const pageActions: MenuAction[] = [
    {
      kind: "item",
      id: "new-notebook",
      label: tShell("list.newNotebook"),
      icon: Add01Icon,
      onSelect: () => setCreating({ files: [] }),
    },
    {
      kind: "item",
      id: "new-folder",
      label: tShell("list.newFolder"),
      icon: FolderAddIcon,
      onSelect: () => setCreatingFolder(true),
    },
    {
      kind: "item",
      id: "import",
      label: tShell("list.importFiles"),
      icon: FileImportIcon,
      onSelect: () => importInput.current?.click(),
    },
    { kind: "separator", id: "s1" },
    {
      kind: "radio",
      id: "view",
      label: tShell("list.view"),
      value: view,
      options: [
        { value: "list", label: tShell("list.viewList") },
        { value: "grid", label: tShell("list.viewGrid") },
      ],
      onChange: chooseView,
    },
    {
      kind: "radio",
      id: "sort",
      label: tShell("list.sortBy"),
      value: sort,
      options: [
        { value: "recent", label: tShell("list.recent") },
        { value: "name", label: tShell("list.name") },
      ],
      onChange: chooseSort,
    },
  ];

  const openFolder = (id: string | null) => setParams(id ? { folder: id } : {});

  const shownFolders =
    section === "recents"
      ? []
      : sortItems(
          folders.filter((folder) => (folder.parentId ?? null) === current),
          sort,
          (folder) => folder.name,
        );
  const shownNotebooks = notebooks
    ? section === "recents"
      ? [...notebooks].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 24)
      : sortItems(
          notebooks.filter((notebook) => (notebook.folderId ?? null) === current),
          sort,
          (notebook) => notebook.title,
        )
    : undefined;
  const searching = query.trim() !== "";
  const found = searching
    ? sortItems(searchNotebooks(query, notebooks ?? [], titles), sort, (notebook) => notebook.title)
    : [];
  const vaultEmpty = notebooks !== undefined && notebooks.length === 0 && folders.length === 0;
  const empty =
    shownNotebooks !== undefined && shownNotebooks.length === 0 && shownFolders.length === 0;
  const grouped = grouping && section !== "recents" && !searching;
  const subjectNotebooks = grouped
    ? shownNotebooks?.filter((notebook) => !libraryIds.has(notebook.id))
    : shownNotebooks;
  const bookNotebooks = grouped
    ? (shownNotebooks ?? []).filter((notebook) => libraryIds.has(notebook.id))
    : [];
  const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]));
  const notebookItem = (notebook: Notebook, as: HomeView, where?: string) => (
    <NotebookItem
      key={notebook.id}
      notebook={notebook}
      folders={folders}
      vaults={vaults ?? []}
      sources={counts?.get(notebook.id)?.sources ?? 0}
      titles={titles.get(notebook.id)}
      progress={progress.get(notebook.id)}
      where={where}
      view={as}
      book={libraryIds.has(notebook.id)}
    />
  );
  const items = (list: Notebook[], withFolder = false) =>
    view === "grid" ? (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
        {list.map((notebook) => notebookItem(notebook, "grid"))}
      </div>
    ) : (
      <div className="border-b">
        {list.map((notebook) =>
          notebookItem(
            notebook,
            "list",
            withFolder && notebook.folderId ? folderNames.get(notebook.folderId) : undefined,
          ),
        )}
      </div>
    );

  /** What a folder holds, for its tile. */
  const sizeOf = (id: string) =>
    folders.filter((folder) => folder.parentId === id).length +
    (notebooks ?? []).filter((notebook) => notebook.folderId === id).length;

  async function dropCards(event: DragEvent, target: string | null) {
    const notebookId = event.dataTransfer.getData(NOTEBOOK_DRAG);
    const folderId = event.dataTransfer.getData(FOLDER_DRAG);
    if (notebookId) await updateNotebook(notebookId, { folderId: target });
    if (folderId && folderId !== target) await moveFolder(folderId, target, folders);
  }

  function describe(error: unknown): string {
    if (error instanceof IngestError) {
      if (error.reason === "read")
        return tSources("errors.read", { name: error.subject, error: error.detail });
      return tSources(`errors.${error.reason}`, { name: error.subject });
    }
    return error instanceof Error ? error.message : String(error);
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        if (panelPage) return;
        dragDepth.current += 1;
        setFileDrag(true);
      }}
      onDragOver={(event) => {
        if (isFileDrag(event)) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!isFileDrag(event) || panelPage) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setFileDrag(false);
      }}
      onDrop={(event) => {
        if (!isFileDrag(event)) return;
        const taken = event.defaultPrevented;
        event.preventDefault();
        dragDepth.current = 0;
        setFileDrag(false);
        if (panelPage || taken) return;
        const files = [...event.dataTransfer.files];
        if (files.length > 0) setCreating({ files });
      }}
    >
      {panelPage ? (
        <>
          {/* Study's bar; Notes and the tools draw their own header, so phones only keep it for the menu. */}
          <header
            data-window-bar
            className={cn(
              "flex min-h-13 shrink-0 items-center gap-2 ps-5 pe-2 max-md:ps-1",
              fullPage && "md:hidden",
              focusedReader && "hidden",
            )}
          >
            <SidebarMenuButton />
            <h1 className="min-w-0 flex-1 truncate text-[0.8125rem] leading-5 font-medium">{title}</h1>
            {fullPage ? null : (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={openCommandPalette}
                aria-label={t("vaults.search")}
                title={`${t("vaults.search")} (${shortcutKeys("k").join(" ")})`}
                className="text-muted-foreground max-md:size-11"
              >
                <Icon icon={Search01Icon} size={16} strokeWidth={1.5} />
              </Button>
            )}
          </header>
          <StudyReturnLinks className="shrink-0 px-3 sm:px-5" />
          <main
            className={cn(
              "min-h-0 flex-1",
              !focusedReader && section !== "bot" && section !== "calendar" && "max-md:px-2 max-md:pb-2",
            )}
          >
            <Suspense
              fallback={
                <Desk className="h-full items-center justify-center text-sm text-muted-foreground">
                  {tCommon("status.loading")}
                </Desk>
              }
            >
              {/* Notes, skills and Study draw their own cards; the bot and the calendar sit on the desk. */}
              {section === "notes" ? (
                <NotesWorkspace />
              ) : section === "study" ? (
                allNotebooks && vaults ? (
                  <StudyWorkspace vaultId={vaultId} notebooks={allNotebooks} vaults={vaults} />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    {tCommon("status.loading")}
                  </div>
                )
              ) : section === "skills" ? (
                <SkillsWorkspace />
              ) : section === "bot" ? (
                <Desk className="h-full">
                  <BotView />
                </Desk>
              ) : (
                <Desk className="h-full">
                  <CalendarView />
                </Desk>
              )}
            </Suspense>
          </main>
        </>
      ) : (
        <Desk>
          {/* The list's one header: its name and vault, Add, New folder, then New notebook, the filled button. */}
          <header
            data-window-bar
            className="flex min-h-13 shrink-0 items-center gap-x-3 gap-y-2 border-b ps-5 pe-2 max-md:ps-1"
          >
            <SidebarMenuButton />
            <div className="flex min-w-0 flex-1 items-baseline gap-3">
              <h1 className="truncate text-[0.8125rem] leading-5 font-medium">{title}</h1>
              {vault ? (
                <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                  {vaultName(vault)}
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <AddButton variant="ghost" size="sm" className="max-md:h-11">
                <Icon icon={Add01Icon} size={16} strokeWidth={1.5} className="text-muted-foreground" />
                <span className="max-sm:sr-only">{tShell("list.add")}</span>
              </AddButton>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCreatingFolder(true)}
                className="max-md:h-11"
              >
                <Icon icon={FolderAddIcon} size={16} strokeWidth={1.5} className="text-muted-foreground" />
                <span className="max-sm:sr-only">{tShell("list.newFolder")}</span>
              </Button>
              <Menu>
                <Menu.Trigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={tShell("list.more")}
                      title={tShell("list.more")}
                      className="text-muted-foreground data-popup-open:bg-muted max-md:size-11"
                    />
                  }
                >
                  <Icon icon={MoreHorizontalIcon} size={16} strokeWidth={1.5} />
                </Menu.Trigger>
                <Menu.Content align="end">
                  <Menu.Item onClick={() => importInput.current?.click()}>
                    <Icon icon={FileImportIcon} />
                    {tShell("list.importFiles")}
                  </Menu.Item>
                </Menu.Content>
              </Menu>
              <span aria-hidden="true" className="mx-1 hidden h-4 w-px bg-border sm:block" />
              {/* In an empty vault Add is the one action, so New notebook steps back to outline. */}
              <Button
                size="sm"
                variant={vaultEmpty ? "outline" : "default"}
                onClick={() => setCreating({ files: [] })}
                className="max-md:h-11"
              >
                {tShell("list.newNotebook")}
              </Button>
            </div>
          </header>
          <StudyReturnLinks className="shrink-0 px-3 sm:px-5" />

          <ContextMenu>
            <ContextMenuTrigger render={<div className="flex min-h-0 flex-1 flex-col" />}>
              <ScrollArea className="min-h-0 flex-1">
                <main className="mx-auto flex min-h-full w-full max-w-190 flex-col gap-6 px-6 pt-[clamp(24px,5vh,48px)] pb-16 max-md:px-4">
                  {vaultEmpty ? (
                    <section
                      aria-labelledby="vault-empty"
                      className="rounded-xl border bg-foreground/[0.02] p-7 animate-in fade-in-0 slide-in-from-bottom-1.5 duration-200 motion-reduce:animate-none"
                    >
                      <h2 id="vault-empty" className="text-sm font-medium">
                        {tShell("list.emptyTitle")}
                      </h2>
                      <p id="vault-empty-line" className="mt-1 text-[0.8125rem] leading-5 text-pretty text-muted-foreground">
                        {tShell("list.emptyBody")}
                      </p>
                      <AddButton aria-describedby="vault-empty-line" className="mt-5 h-10 rounded-xl px-4">
                        <Icon icon={Add01Icon} size={16} strokeWidth={1.5} />
                        {tShell("list.add")}
                      </AddButton>
                    </section>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input.Group size="sm" className="min-w-0 flex-[1_1_15rem] max-md:h-11">
                          <Input.Addon>
                            <Icon icon={Search01Icon} size={16} strokeWidth={1.5} />
                          </Input.Addon>
                          <Input
                            ref={searchInput}
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape" && query) {
                                event.preventDefault();
                                setQuery("");
                              }
                            }}
                            aria-label={tShell("list.search")}
                            placeholder={tShell("list.search")}
                            className="[&::-webkit-search-cancel-button]:hidden"
                          />
                          {searching ? (
                            <Input.Addon align="end" className="pe-1">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={tShell("list.clearSearch")}
                                title={tShell("list.clearSearch")}
                                onClick={() => {
                                  setQuery("");
                                  searchInput.current?.focus();
                                }}
                                className="size-6 rounded-sm text-muted-foreground"
                              >
                                <Icon icon={Cancel01Icon} size={14} strokeWidth={1.5} />
                              </Button>
                            </Input.Addon>
                          ) : null}
                        </Input.Group>
                        {section === "recents" ? null : (
                          <Menu>
                            <Menu.Trigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  aria-label={`${tShell("list.sortMenu")}: ${tShell(`list.${sort}`)}`}
                                  className="data-popup-open:bg-muted max-md:h-11"
                                />
                              }
                            >
                              <span className="text-muted-foreground">{tShell("list.sort")}</span>
                              {tShell(`list.${sort}`)}
                              <Icon icon={ArrowDown01Icon} size={14} strokeWidth={1.5} className="text-muted-foreground" />
                            </Menu.Trigger>
                            <Menu.Content align="end" className="w-56">
                              <Menu.Group>
                                <Menu.GroupLabel>{tShell("list.sortBy")}</Menu.GroupLabel>
                                <Menu.RadioGroup value={sort} onValueChange={chooseSort}>
                                  <Menu.RadioItem value="recent">
                                    {tShell("list.recent")}
                                    <Menu.Description>{tShell("list.recentDetail")}</Menu.Description>
                                  </Menu.RadioItem>
                                  <Menu.RadioItem value="name">
                                    {tShell("list.name")}
                                    <Menu.Description>{tShell("list.nameDetail")}</Menu.Description>
                                  </Menu.RadioItem>
                                </Menu.RadioGroup>
                              </Menu.Group>
                            </Menu.Content>
                          </Menu>
                        )}
                        <Menu>
                          <Menu.Trigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={tShell("list.view")}
                                title={tShell("list.view")}
                                className="text-muted-foreground data-popup-open:bg-muted max-md:size-11"
                              />
                            }
                          >
                            <Icon icon={view === "grid" ? GridViewIcon : Menu01Icon} size={16} strokeWidth={1.5} />
                          </Menu.Trigger>
                          <Menu.Content align="end">
                            <Menu.Group>
                              <Menu.GroupLabel>{tShell("list.view")}</Menu.GroupLabel>
                              <Menu.RadioGroup value={view} onValueChange={chooseView}>
                                <Menu.RadioItem value="list">{tShell("list.viewList")}</Menu.RadioItem>
                                <Menu.RadioItem value="grid">{tShell("list.viewGrid")}</Menu.RadioItem>
                              </Menu.RadioGroup>
                            </Menu.Group>
                            <Menu.Separator />
                            <Menu.CheckboxItem
                              checked={grouping}
                              onCheckedChange={(next: boolean) => {
                                setGrouping(next);
                                remember(groupKey, next ? "on" : "off");
                              }}
                            >
                              {t("library.group")}
                            </Menu.CheckboxItem>
                          </Menu.Content>
                        </Menu>
                      </div>

                      {/* Where in the vault's folders the list is; each step takes dropped notebooks and folders. */}
                      {path.length && !searching ? (
                        <nav
                          aria-label={tShell("list.breadcrumb")}
                          className="-mt-2 flex [scrollbar-width:none] items-center gap-1 overflow-x-auto text-[0.8125rem] leading-5 text-muted-foreground"
                        >
                          <PathStep active={false} onOpen={() => openFolder(null)} onDropCards={(event) => void dropCards(event, null)}>
                            {tShell("list.title")}
                          </PathStep>
                          {path.map((folder: Folder) => (
                            <Crumbs key={folder.id}>
                              <PathStep
                                active={folder.id === current}
                                onOpen={() => openFolder(folder.id)}
                                onDropCards={(event) => void dropCards(event, folder.id)}
                              >
                                {folder.name}
                              </PathStep>
                            </Crumbs>
                          ))}
                        </nav>
                      ) : null}

                      {searching ? (
                        found.length ? (
                          <section aria-labelledby="notebooks-found">
                            <SectionHead
                              id="notebooks-found"
                              title={tShell("list.notebooks")}
                              detail={tShell("list.matches", { count: found.length })}
                            />
                            {items(found, true)}
                          </section>
                        ) : (
                          <section
                            aria-labelledby="no-match"
                            role="status"
                            className="border-t pt-4 animate-in fade-in-0 slide-in-from-bottom-1.5 duration-200 motion-reduce:animate-none"
                          >
                            <h2 id="no-match" className="text-sm font-medium">
                              {tShell("list.noMatchTitle", { query: query.trim() })}
                            </h2>
                            <p className="mt-1 text-[0.8125rem] leading-5 text-muted-foreground">
                              {tShell("list.noMatchBody")}
                            </p>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="-ms-2.5 mt-3"
                              onClick={() => {
                                setQuery("");
                                searchInput.current?.focus();
                              }}
                            >
                              {tShell("list.clearSearch")}
                            </Button>
                          </section>
                        )
                      ) : empty ? (
                        <section aria-labelledby="folder-empty" className="border-t pt-4">
                          <h2 id="folder-empty" className="text-sm font-medium">
                            {section === "recents" ? t("vaults.emptyFolder") : tShell("list.emptyFolderTitle")}
                          </h2>
                          <p className="mt-1 text-[0.8125rem] leading-5 text-muted-foreground">
                            {tShell("list.emptyFolderBody")}
                          </p>
                        </section>
                      ) : (
                        <>
                          {shownFolders.length ? (
                            <section aria-labelledby="folders-head">
                              <SectionHead id="folders-head" title={tShell("list.folders")} />
                              <div
                                className={
                                  view === "grid"
                                    ? "grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2"
                                    : "border-b"
                                }
                              >
                                {shownFolders.map((folder) => (
                                  <FolderItem
                                    key={folder.id}
                                    folder={folder}
                                    folders={folders}
                                    size={sizeOf(folder.id)}
                                    view={view}
                                    onOpen={() => openFolder(folder.id)}
                                    onDropCards={(event) => void dropCards(event, folder.id)}
                                  />
                                ))}
                              </div>
                            </section>
                          ) : null}
                          {subjectNotebooks?.length ? (
                            <section aria-labelledby="notebooks-head">
                              <SectionHead
                                id="notebooks-head"
                                title={tShell("list.notebooks")}
                                detail={tShell("list.count", { count: subjectNotebooks.length })}
                              />
                              {items(subjectNotebooks)}
                            </section>
                          ) : null}
                          {bookNotebooks.length ? (
                            // Open by itself when the vault holds nothing else, so the list never looks empty.
                            <details
                              className="group/library"
                              open={!subjectNotebooks?.length && !shownFolders.length ? true : undefined}
                            >
                              <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-md py-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
                                <Icon
                                  icon={ArrowRight01Icon}
                                  size={14}
                                  strokeWidth={1.5}
                                  className="transition-transform group-open/library:rotate-90 motion-reduce:transition-none rtl:-scale-x-100"
                                />
                                <Icon icon={Books01Icon} size={16} strokeWidth={1.5} />
                                {t("library.title")}
                                <span className="font-normal tabular-nums">{bookNotebooks.length}</span>
                              </summary>
                              <p className="mt-1 mb-3 text-xs text-muted-foreground">{t("library.description")}</p>
                              {items(bookNotebooks)}
                            </details>
                          ) : null}
                        </>
                      )}
                      {!folders.length && !searching && section !== "recents" ? (
                        <p className="text-xs text-muted-foreground">{tShell("list.folderHint")}</p>
                      ) : null}
                    </>
                  )}
                </main>
              </ScrollArea>
            </ContextMenuTrigger>
            <Menu.Content sideOffset={0}>
              <MenuActions actions={pageActions} />
            </Menu.Content>
          </ContextMenu>
        </Desk>
      )}

      <input
        ref={importInput}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        className="hidden"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length > 0) setCreating({ files });
        }}
      />

      {fileDrag ? (
        <div className="pointer-events-none absolute inset-3 z-20 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-muted-foreground/50 bg-background/85 backdrop-blur-sm">
          <span className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Icon icon={FileUploadIcon} size={26} />
          </span>
          <p className="text-lg font-semibold">{t("drop.title")}</p>
          <p className="text-sm text-muted-foreground">{t("drop.body")}</p>
        </div>
      ) : null}

      <FirstRun />
      <NotebookDialog
        open={creating !== null}
        onOpenChange={(open) => !open && setCreating(null)}
        mode="create"
        folders={folders}
        files={creating?.files}
        onRemoveFile={(file) =>
          setCreating((state) =>
            state ? { files: state.files.filter((each) => each !== file) } : state,
          )
        }
        initial={{
          title: creating?.files[0]?.name.replace(/\.[^.]+$/, "") ?? "",
          folderId: current,
        }}
        onSubmit={async (details) => {
          const { title: name, ...look } = details;
          const id = await createNotebook(name || t("untitled"), {
            ...look,
            ...(vaultId !== DEFAULT_VAULT ? { vaultId } : {}),
          });
          const failures: string[] = [];
          const imported = [];
          for (const file of creating?.files ?? []) {
            try {
              imported.push(await ingestFile(id, file));
            } catch (error) {
              failures.push(describe(error));
            }
          }
          for (const failure of failures) toast.error(failure);
          const path = routes.notebook(id);
          navigate(imported.length && !imported.some(sourceHasText) ? `${path}?tab=sources` : path);
        }}
      />
      <FolderDialog
        open={creatingFolder}
        onOpenChange={setCreatingFolder}
        mode="create"
        initial={{ name: "" }}
        onSubmit={async ({ name, color }) => {
          await createFolder(name, current, color, vaultId);
        }}
      />
    </div>
  );
}

/** A button that opens the sidebar's Add box (a link, files or text). */
function AddButton(props: Omit<ComponentProps<typeof Button>, "onClick">) {
  const { setAdding } = useSidebar();
  return <Button {...props} onClick={() => setAdding(true)} />;
}

/** A section's small heading, with a count at the end. */
function SectionHead({ id, title, detail }: { id: string; title: string; detail?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 id={id} className="text-xs font-medium text-muted-foreground">
        {title}
      </h2>
      {detail ? <span className="text-xs text-muted-foreground tabular-nums">{detail}</span> : null}
    </div>
  );
}

function Crumbs({ children }: { children: ReactNode }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Icon icon={ArrowRight01Icon} size={14} strokeWidth={1.5} className="rtl:-scale-x-100" />
      {children}
    </span>
  );
}

/** One step of the folder path; notebooks and folders can be dropped on it to move them there. */
function PathStep({
  children,
  active,
  onOpen,
  onDropCards,
}: {
  children: ReactNode;
  active: boolean;
  onOpen: () => void;
  onDropCards: (event: DragEvent) => void;
}) {
  const drop = useDropTarget(onDropCards);
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onOpen}
      aria-current={active ? "page" : undefined}
      {...drop.props}
      className={cn(
        "h-7 px-1.5 font-normal text-muted-foreground hover:text-foreground max-md:h-11",
        active && "font-medium text-foreground",
        drop.over && "bg-muted ring-1 ring-muted-foreground",
      )}
    >
      {children}
    </Button>
  );
}
