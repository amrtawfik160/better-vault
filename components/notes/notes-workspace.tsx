import {
  Add01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  BookOpen01Icon,
  Cancel01Icon,
  Edit02Icon,
  HierarchyCircle01Icon,
  KeyboardIcon,
  Menu01Icon,
  SidebarRightIcon,
} from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { ToolHeader, ToolHeaderDivider } from "@/components/common/tool-header";
import { Icon } from "@/components/icon";
import { ScrollArea } from "@/components/ui/scroll-area";
import { openCommandPalette } from "@/lib/command";
import { createNote, renameNote, saveNoteBody } from "@/lib/db/notes";
import type { Note, NoteLink } from "@/lib/db/types";
import { startNoteTutor } from "@/lib/db/study";
import { studyHref } from "@/lib/study/links";
import { studyReturnState } from "@/lib/study/return-links";
import { Button } from "@/components/panelui/button";
import { Sheet } from "@/components/panelui/sheet";
import { useCurrentVault, vaultOf } from "@/lib/db/vaults";
import { formatRelativeTime } from "@/lib/format";
import type { GraphNode } from "@/lib/notes/graph";
import { resolveLink } from "@/lib/notes/resolve";
import { noteEditorText, readNoteMatch } from "@/lib/notes/search-match";
import { extractHeadings, sameName } from "@/lib/notes/syntax";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { CompletionWorld } from "./editor/completion";
import { NoteEditor, type NoteEditorHandle } from "./editor/note-editor";
import { GraphView } from "./graph-view";
import { NoteTabs } from "./note-tabs";
import { NoteDetails } from "./note-details";
import { NoteList } from "./note-list";
import { NoteReader } from "./note-reader";
import { readNoteSelection } from "./note-reading-selection";
import { NoteStudyCards } from "./note-study-cards";
import { NoteSwitcher } from "./note-switcher";
import { ShortcutsDialog, keyLabel } from "./shortcuts-dialog";
import { useNotesWorld } from "./use-notes-world";
import { SelectableText } from "@/components/selection/selectable-text";

const GRAPH_TAB = "graph";
const TABS_KEY = "better-vault:notes-tabs";
const MODE_KEY = "better-vault:notes-mode";
const DETAILS_KEY = "better-vault:notes-details";
const listBreakpoint = "(min-width: 48rem)";
const detailsBreakpoint = "(min-width: 64rem)";

function noteLayout() {
  if (typeof window === "undefined" || window.matchMedia(detailsBreakpoint).matches) return "wide";
  return window.matchMedia(listBreakpoint).matches ? "split" : "narrow";
}

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows may refuse storage; the page works without it.
  }
};

/**
 * The notes page, in the spirit of Obsidian: a list of the vault's notes,
 * tabs of open notes with a Live Preview editor (or the reading view), the
 * note's backlinks and outline, and the graph of how everything links,
 * across vaults. Obsidian's keys work throughout.
 */
export default function NotesWorkspace() {
  const { t, i18n } = useTranslation("notes");
  const { t: common } = useTranslation();
  const navigate = useNavigate();
  const { state, key: routeKey } = useLocation();
  const world = useNotesWorld();
  const vaultId = useCurrentVault(world?.vaults);
  const [params, setParams] = useSearchParams();
  const activeId = params.get("note");
  const citedHeading = params.get("heading");
  const graphOpen = params.get("graph") === "1";
  const notebookFilter = params.get("notebook");

  const [tabs, setTabs] = useState<string[]>(() => read<string[]>(TABS_KEY, []));
  const [lastActiveNote, setLastActiveNote] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "read">(() => read(MODE_KEY, "edit"));
  const [dismissedMatch, setDismissedMatch] = useState<string | null>(null);
  const [details, setDetails] = useState<boolean>(() => read(DETAILS_KEY, true));
  const [layout, setLayout] = useState(noteLayout);
  const [mobilePane, setMobilePane] = useState<"library" | "details" | null>(null);
  const [query, setQuery] = useState("");
  const [switcher, setSwitcher] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  // A note just made gets its title selected, ready to type over.
  const [freshNote, setFreshNote] = useState<string | null>(null);
  const history = useRef<{ back: string[]; forward: string[] }>({ back: [], forward: [] });
  const editor = useRef<NoteEditorHandle>(null);
  const readingBody = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusLibrarySearch = useRef(false);
  const returnPaneFocus = useRef(true);
  const pendingReveal = useRef<string | null>(null);
  const revealedRoute = useRef<string | null>(null);

  const notes = world?.notes;
  const byId = useMemo(() => new Map((notes ?? []).map((note) => [note.id, note])), [notes]);
  const note = activeId ? (byId.get(activeId) ?? null) : null;
  const libraryOnly = layout === "narrow" && !note && !graphOpen;
  const noteId = note?.id ?? null;
  // A note opened through search or a citation bypasses the tab switcher.
  if (lastActiveNote !== noteId) {
    setLastActiveNote(noteId);
    if (noteId && !tabs.includes(noteId)) setTabs([...tabs, noteId]);
  }
  const searchMatch = useMemo(() => readNoteMatch(state), [state]);
  const showingMatch = Boolean(searchMatch && !graphOpen && dismissedMatch !== routeKey);
  const displayedMode = showingMatch ? "edit" : mode;
  const toggleMode = useCallback(() => {
    if (showingMatch) setDismissedMatch(routeKey);
    setMode(displayedMode === "edit" ? "read" : "edit");
  }, [displayedMode, showingMatch, routeKey]);
  useEffect(() => {
    if (!noteId || !showingMatch || !searchMatch) return;
    const frame = requestAnimationFrame(() => editor.current?.revealMatch(searchMatch));
    return () => cancelAnimationFrame(frame);
  }, [noteId, routeKey, searchMatch, showingMatch]);
  const listNotes = useMemo(
    () =>
      (notes ?? []).filter((each) =>
        notebookFilter ? each.notebookId === notebookFilter : each.vaultId === vaultId,
      ),
    [notes, vaultId, notebookFilter],
  );
  const filterNotebook = notebookFilter
    ? world?.notebooks.find((each) => each.id === notebookFilter)
    : undefined;
  const noteNotebook = world?.notebooks.find(({ id }) => id === note?.notebookId);

  function noteSnapshot(note: Note) {
    const draft = editor.current?.studySnapshot();
    if (draft) return draft;
    const body = noteEditorText(note.body);
    const root = readingBody.current;
    return { body, selection: root ? readNoteSelection(root, body) : undefined };
  }

  useEffect(() => write(TABS_KEY, tabs), [tabs]);
  useEffect(() => write(MODE_KEY, mode), [mode]);
  useEffect(() => write(DETAILS_KEY, details), [details]);
  useEffect(() => {
    const queries = [window.matchMedia(listBreakpoint), window.matchMedia(detailsBreakpoint)];
    const resize = () => {
      setLayout(noteLayout());
      setMobilePane(null);
    };
    queries.forEach((query) => query.addEventListener("change", resize));
    return () => queries.forEach((query) => query.removeEventListener("change", resize));
  }, []);

  const choosePane = useCallback((pane: "library" | "details", search = false) => {
    returnPaneFocus.current = true;
    focusLibrarySearch.current = search;
    setMobilePane(pane);
  }, []);

  function leavePane() {
    returnPaneFocus.current = false;
    setMobilePane(null);
  }

  const show = useCallback(
    (next: { note?: string | null; graph?: boolean }, record = true) => {
      const current = params.get("graph") === "1" ? GRAPH_TAB : params.get("note");
      const target = next.graph ? GRAPH_TAB : (next.note ?? null);
      if (record && current && current !== target) {
        history.current.back.push(current);
        history.current.forward = [];
      }
      const out: Record<string, string> = { view: "notes" };
      if (notebookFilter) out.notebook = notebookFilter;
      if (next.graph) out.graph = "1";
      const keep = next.graph ? (params.get("note") ?? undefined) : (next.note ?? undefined);
      if (keep) out.note = keep;
      setParams(out, { state: studyReturnState(state) });
    },
    [params, setParams, notebookFilter, state],
  );

  /** Opens a note in the current tab, or a new one (⌘-click). */
  const open = useCallback(
    (id: string, newTab = false) => {
      setTabs((current) => {
        if (current.includes(id)) return current;
        const at = current.indexOf(graphOpen ? GRAPH_TAB : (activeId ?? ""));
        if (newTab || at < 0) return [...current, id];
        const next = [...current];
        next[at] = id;
        return next;
      });
      show({ note: id });
    },
    [activeId, graphOpen, show],
  );

  const openGraph = useCallback(() => {
    setTabs((current) => (current.includes(GRAPH_TAB) ? current : [...current, GRAPH_TAB]));
    show({ graph: true });
  }, [show]);

  const closeTab = useCallback(
    (id: string) => {
      const at = tabs.indexOf(id);
      const next = tabs.filter((each) => each !== id);
      setTabs(next);
      if (id !== (graphOpen ? GRAPH_TAB : activeId)) return;
      const neighbour = next[Math.min(at, next.length - 1)];
      if (neighbour === GRAPH_TAB) show({ graph: true }, false);
      else show({ note: neighbour ?? null }, false);
    },
    [activeId, graphOpen, show, tabs],
  );

  const newNote = useCallback(
    async (title = "") => {
      const created = await createNote({
        vaultId: filterNotebook?.vaultId ?? vaultId,
        title: title || t("untitled"),
        notebookId: notebookFilter,
      });
      setFreshNote(created.id);
      open(created.id);
      setMode("edit");
    },
    [vaultId, notebookFilter, filterNotebook, open, t],
  );

  const revealHeading = useCallback(
    (heading: string) => {
      if (!note) return;
      const found = extractHeadings(noteEditorText(note.body)).find((each) => sameName(each.text, heading));
      if (!found) return;
      setMode("edit");
      requestAnimationFrame(() => editor.current?.reveal(found.from));
    },
    [note],
  );

  const openLink = useCallback(
    async (link: NoteLink) => {
      if (!world) return;
      if (!link.target && link.heading) return revealHeading(link.heading);
      const fromVault = note?.vaultId ?? vaultId;
      const target = resolveLink(link, world, fromVault);
      if (target?.kind === "note") {
        pendingReveal.current = link.heading ?? null;
        open(target.note.id);
      } else if (target?.kind === "notebook") {
        navigate(routes.notebook(target.notebook.id), { state: studyReturnState(state) });
      } else if (target?.kind === "source") {
        navigate(
          `${routes.notebook(target.source.notebookId)}?source=${encodeURIComponent(target.source.id)}`,
          { state: studyReturnState(state) },
        );
      } else if (link.kind === "note" && link.target) {
        // A link to nothing yet creates the note, in the vault it names.
        const slash = link.target.indexOf("/");
        const named =
          slash > 0
            ? world.vaults.find((v) => sameName(world.vaultName(v), link.target.slice(0, slash)))
            : undefined;
        const created = await createNote({
          vaultId: named?.id ?? fromVault,
          title: named ? link.target.slice(slash + 1) : link.target,
          notebookId: notebookFilter,
        });
        open(created.id);
      } else {
        toast.error(t("missing"));
      }
    },
    [world, note, vaultId, open, navigate, revealHeading, notebookFilter, state, t],
  );

  // After following a `[[Note#Heading]]` link, scroll to the heading once the note is open.
  useEffect(() => {
    const heading = pendingReveal.current;
    if (!note) return;
    if (heading) {
      pendingReveal.current = null;
      revealHeading(heading);
    } else if (citedHeading && revealedRoute.current !== routeKey) {
      revealedRoute.current = routeKey;
      revealHeading(citedHeading);
    }
  }, [note, revealHeading, routeKey, citedHeading]);

  const go = useCallback(
    (direction: "back" | "forward") => {
      const stacks = history.current;
      const from = direction === "back" ? stacks.back : stacks.forward;
      const to = direction === "back" ? stacks.forward : stacks.back;
      const target = from.pop();
      if (!target) return;
      const current = graphOpen ? GRAPH_TAB : activeId;
      if (current) to.push(current);
      if (target === GRAPH_TAB) show({ graph: true }, false);
      else {
        setTabs((list) => (list.includes(target) ? list : [...list, target]));
        show({ note: target }, false);
      }
    },
    [activeId, graphOpen, show],
  );

  // Obsidian's workspace keys. Editing keys live in the editor itself.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || ["INPUT", "TEXTAREA"].includes(event.target.tagName));
      if (mod && !event.shiftKey && !event.altKey && key === "n") {
        event.preventDefault();
        void newNote();
      } else if (mod && !event.shiftKey && key === "o") {
        event.preventDefault();
        setSwitcher(true);
      } else if (mod && !event.shiftKey && key === "p") {
        event.preventDefault();
        openCommandPalette();
      } else if (mod && event.shiftKey && key === "f") {
        event.preventDefault();
        if (layout === "narrow" && !libraryOnly && mobilePane !== "library") choosePane("library", true);
        else searchRef.current?.focus();
      } else if (mod && !event.shiftKey && key === "e") {
        event.preventDefault();
        toggleMode();
      } else if (mod && !event.shiftKey && key === "g") {
        event.preventDefault();
        if (graphOpen) show({ note: activeId });
        else openGraph();
      } else if (mod && event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        go(event.key === "ArrowLeft" ? "back" : "forward");
      } else if (mod && !event.shiftKey && key === "w") {
        const current = graphOpen ? GRAPH_TAB : activeId;
        if (current) {
          event.preventDefault();
          closeTab(current);
        }
      } else if (!mod && event.key === "?" && !typing) {
        event.preventDefault();
        setShortcuts(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newNote, openGraph, show, go, closeTab, graphOpen, activeId, toggleMode, layout, libraryOnly, mobilePane, choosePane]);

  const completion = useCallback((): CompletionWorld => {
    if (!world) return { notes: [], notebooks: [], sources: [], tags: [] };
    const here = note?.vaultId ?? vaultId;
    const vaultLabel = new Map(world.vaults.map((vault) => [vault.id, world.vaultName(vault)]));
    return {
      notes: world.notes
        .filter((each) => each.id !== note?.id)
        .map((each) => ({
          title: each.title,
          vault: vaultLabel.get(each.vaultId) ?? "",
          aliases: each.aliases,
          here: each.vaultId === here,
        })),
      notebooks: world.notebooks.map((each) => each.title),
      sources: world.sources.map((each) => each.title),
      tags: [...new Set(world.notes.flatMap((each) => each.tags))].sort(),
    };
  }, [world, note, vaultId]);

  const resolves = useCallback(
    (link: NoteLink) =>
      (!link.target && !!link.heading) ||
      (world ? resolveLink(link, world, note?.vaultId ?? vaultId) !== null : false),
    [world, note, vaultId],
  );

  if (!world) return null;
  const noteVaults = world.vaults;

  const vaultLabel = (each: Note) => {
    if (each.vaultId === vaultId) return null;
    const vault = world.vaults.find((v) => v.id === each.vaultId);
    return vault ? world.vaultName(vault) : null;
  };
  const activeTab = graphOpen ? GRAPH_TAB : activeId;
  // Tabs of deleted notes are left out.
  const visibleTabs = tabs.filter((id) => id === GRAPH_TAB || byId.has(id));

  function renderLibrary(inSheet = false) {
    return (
      <NoteList
        title={t("title")}
        inSheet={inSheet}
        banner={
          filterNotebook ? (
            <div className="flex items-center gap-2 rounded-xl bg-muted px-2.5 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate">
                {t("fromNotebook", { title: filterNotebook.title })}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("thisVault")}
                title={t("thisVault")}
                onClick={() =>
                  setParams(
                    { view: "notes", ...(activeId ? { note: activeId } : {}) },
                    { state: studyReturnState(state) },
                  )
                }
                className="-me-1 size-6 rounded-full hover:bg-background"
              >
                <Icon icon={Cancel01Icon} size={12} />
              </Button>
            </div>
          ) : null
        }
        notes={listNotes}
        vaults={noteVaults}
        activeId={graphOpen ? null : activeId}
        query={query}
        onQuery={setQuery}
        onOpenGraph={libraryOnly ? openGraph : undefined}
        onOpen={(id, newTab) => {
          if (inSheet) leavePane();
          open(id, newTab);
        }}
        onCreate={() => {
          if (inSheet) leavePane();
          void newNote();
        }}
        onImport={(files) =>
          void (async () => {
            let opened: string | null = null;
            for (const file of files) {
              const created = await createNote({
                vaultId: filterNotebook?.vaultId ?? vaultId,
                title: file.name.replace(/\.(md|markdown|txt)$/i, ""),
                body: await file.text(),
                notebookId: notebookFilter,
              });
              opened ??= created.id;
            }
            toast.success(t("actions.imported", { count: files.length }));
            if (opened) {
              if (inSheet) leavePane();
              open(opened);
            }
          })()
        }
        onDeleted={(id) => {
          if (inSheet && id === activeId) leavePane();
          closeTab(id);
        }}
        searchRef={searchRef}
      />
    );
  }

  function renderDetails(inSheet = false) {
    if (!note || !world) return null;
    return (
      <NoteDetails
        note={note}
        world={world}
        onOpen={(id) => {
          if (inSheet) leavePane();
          open(id);
        }}
        onLinkMention={(other) => {
          const pattern = new RegExp(
            `(^|[^\\p{L}\\p{N}\\[])(${note.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\p{L}\\p{N}\\]])`,
            "iu",
          );
          void saveNoteBody(
            other.id,
            other.body.replace(
              pattern,
              (_, lead: string, name: string) =>
                `${lead}[[${note.title}${name === note.title ? "" : `|${name}`}]]`,
            ),
          );
        }}
        onHeading={(offset) => {
          if (inSheet) leavePane();
          setMode("edit");
          requestAnimationFrame(() => editor.current?.reveal(offset));
        }}
      />
    );
  }

  const hasNotes = world.notes.length > 0;
  const noteCount = world.notes.filter((each) => each.vaultId === vaultId).length;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card md:rounded-xl md:border">
      {/* One header: the page, then the graph, the keys and the one filled button. */}
      <ToolHeader
        title={t("title")}
        detail={hasNotes ? t("header.count", { count: noteCount }) : undefined}
      >
        {hasNotes ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={graphOpen}
              aria-label={t("actions.graph")}
              title={`${t("actions.graph")} (${keyLabel("Mod+G")})`}
              onClick={() => (graphOpen ? show({ note: activeId }) : openGraph())}
              className={cn("text-muted-foreground", graphOpen && "bg-muted text-foreground")}
            >
              <Icon icon={HierarchyCircle01Icon} size={16} />
              <span className="max-sm:sr-only">{t("tabs.graph")}</span>
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={t("actions.shortcuts")}
              title={`${t("actions.shortcuts")} (?)`}
              onClick={() => setShortcuts(true)}
              className="hidden text-muted-foreground sm:inline-flex"
            >
              <Icon icon={KeyboardIcon} size={16} />
            </Button>
            <ToolHeaderDivider />
            <Button type="button" size="sm" onClick={() => void newNote()}>
              <Icon icon={Add01Icon} size={16} />
              <span className="max-sm:sr-only">{t("new")}</span>
            </Button>
          </>
        ) : libraryOnly ? (
          // On a phone the empty pane with its New button is hidden behind the list.
          <Button type="button" size="sm" onClick={() => void newNote()}>
            <Icon icon={Add01Icon} size={16} />
            <span className="max-sm:sr-only">{t("new")}</span>
          </Button>
        ) : null}
      </ToolHeader>
      <div className="flex min-h-0 flex-1">
      {libraryOnly || layout !== "narrow" ? (
        <div className={cn("flex min-w-0 shrink-0 flex-col overflow-hidden", libraryOnly ? "w-full" : "w-72 border-e")}>
          {renderLibrary()}
        </div>
      ) : null}
      {/* Tabs, then the open note or the graph. */}
      <div className={cn("flex min-w-0 flex-1 flex-col overflow-hidden", libraryOnly && "hidden")}>
        {/* The tabs flare into the page like folder tabs, so the bar has no rule under it. */}
        <div data-bv="note-tabs" className="note-tabs-bar flex h-12 shrink-0 items-center gap-1 px-3">
          {layout === "narrow" ? (
            <Sheet
              open={!libraryOnly && mobilePane === "library"}
              onOpenChange={(open) => {
                if (open) choosePane("library");
                else setMobilePane(null);
              }}
            >
              <Sheet.Trigger render={<Button type="button" size="icon" variant="ghost" aria-label={t("actions.browse")} />}>
                <Icon icon={Menu01Icon} size={18} />
              </Sheet.Trigger>
              <Sheet.Content
                className="h-[min(44rem,80dvh)]"
                showClose={false}
                initialFocus={() => {
                  const search = focusLibrarySearch.current;
                  focusLibrarySearch.current = false;
                  return search ? searchRef.current ?? true : true;
                }}
                finalFocus={() => returnPaneFocus.current}
              >
                {renderLibrary(true)}
              </Sheet.Content>
            </Sheet>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => go("back")}
            aria-label={t("actions.back")}
            title={`${t("actions.back")} (${keyLabel("Mod+Alt+←")})`}
            className="text-muted-foreground max-md:size-11"
          >
            <Icon icon={ArrowLeft01Icon} size={16} className="rtl:rotate-180" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => go("forward")}
            aria-label={t("actions.forward")}
            title={`${t("actions.forward")} (${keyLabel("Mod+Alt+→")})`}
            className="text-muted-foreground max-md:size-11"
          >
            <Icon icon={ArrowRight01Icon} size={16} className="rtl:rotate-180" />
          </Button>
          <NoteTabs
            tabs={visibleTabs}
            active={activeTab}
            graphTab={GRAPH_TAB}
            labelOf={(id) => (id === GRAPH_TAB ? t("tabs.graph") : (byId.get(id)?.title ?? ""))}
            onShow={(id) => (id === GRAPH_TAB ? show({ graph: true }) : show({ note: id }))}
            onClose={closeTab}
          />
          {note && !graphOpen ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleMode}
              aria-label={t("modes.toggle")}
              title={`${displayedMode === "edit" ? t("modes.edit") : t("modes.read")} · ${t("modes.toggle")} (${keyLabel("Mod+E")})`}
              className="text-muted-foreground max-md:size-11"
            >
              <Icon icon={displayedMode === "edit" ? Edit02Icon : BookOpen01Icon} size={16} />
            </Button>
          ) : null}
          {note && !graphOpen && layout !== "wide" ? (
            <Sheet
              open={mobilePane === "details"}
              onOpenChange={(open) => {
                if (open) choosePane("details");
                else setMobilePane(null);
              }}
            >
              <Sheet.Trigger render={<Button type="button" size="icon" variant="ghost" aria-label={t("panes.show")} />}>
                <Icon icon={SidebarRightIcon} size={18} className="rtl:-scale-x-100" />
              </Sheet.Trigger>
              <Sheet.Content
                className="h-[min(38rem,72dvh)]"
                closeLabel={common("actions.close")}
                finalFocus={() => returnPaneFocus.current}
              >
                <Sheet.Header title={t("panes.label")} />
                {renderDetails(true)}
              </Sheet.Content>
            </Sheet>
          ) : null}
          {note && !graphOpen && layout === "wide" ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setDetails((current) => !current)}
              aria-label={details ? t("panes.hide") : t("panes.show")}
              aria-pressed={details}
              title={details ? t("panes.hide") : t("panes.show")}
              className={cn("hidden text-muted-foreground lg:inline-flex", details && "text-foreground")}
            >
              <Icon icon={SidebarRightIcon} size={16} className="rtl:-scale-x-100" />
            </Button>
          ) : null}
        </div>

        {graphOpen ? (
          <GraphView
            world={world}
            vaultColors={world.vaultColors}
            focusId={activeId && byId.has(activeId) ? activeId : null}
            onOpen={(node: GraphNode) => {
              const [kind, id] = [
                node.id.slice(0, node.id.indexOf(":")),
                node.id.slice(node.id.indexOf(":") + 1),
              ];
              if (kind === "note") open(id);
              else if (kind === "missing")
                void openLink({ kind: "note", target: node.label, embed: false });
              else if (kind === "notebook")
                navigate(routes.notebook(id), { state: studyReturnState(state) });
              else if (kind === "source") {
                const source = world.sources.find((each) => each.id === id);
                if (source)
                  navigate(
                    `${routes.notebook(source.notebookId)}?source=${encodeURIComponent(id)}`,
                    { state: studyReturnState(state) },
                  );
              } else if (kind === "tag") {
                setQuery(node.label);
                if (layout === "narrow") choosePane("library");
              }
            }}
          />
        ) : note ? (
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <NoteTitle
                key={`${note.id}:${note.title}`}
                note={note}
                autoFocus={freshNote === note.id}
                onDone={() => {
                  // Enter goes on into the text, as in Obsidian; the renamed title must not take focus back.
                  setFreshNote(null);
                  if (displayedMode === "edit") requestAnimationFrame(() => editor.current?.focus());
                }}
              />
              <p className="mx-auto w-full max-w-[46rem] px-6 text-xs text-muted-foreground">
                {t("updated", { time: formatRelativeTime(note.updatedAt, i18n.language) })} ·{" "}
                {t("words", { count: note.body.trim() ? note.body.trim().split(/\s+/).length : 0 })}
              </p>
              <div className="mx-auto flex w-full max-w-[46rem] flex-wrap gap-1 px-6 pt-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!note.body.trim()}
                  onClick={() => {
                    void startNoteTutor(note)
                      .then((thread) =>
                        navigate(studyHref("practice", { thread: thread.id }), {
                          state: studyReturnState(state),
                        }),
                      )
                      .catch((error: Error) => toast.error(error.message));
                  }}
                >
                  {t("askTutor")}
                </Button>
                <NoteStudyCards
                  key={note.id}
                  note={note}
                  vaultId={noteNotebook ? vaultOf(noteNotebook) : note.vaultId}
                  snapshot={() => noteSnapshot(note)}
                />
              </div>
              {displayedMode === "edit" ? (
                <div className="min-h-0 flex-1">
                  <EditorPane
                    note={note}
                    editorRef={editor}
                    world={completion}
                    resolves={resolves}
                    onOpenLink={openLink}
                  />
                </div>
              ) : (
                <ScrollArea className="min-h-0 flex-1">
                  <div ref={readingBody} className="mx-auto max-w-[46rem] px-6 pt-4 pb-24">
                    <SelectableText
                      place={{
                        title: note.title,
                        notebookId: note.notebookId ?? undefined,
                        vaultId: note.vaultId,
                        tags: [note.title],
                        origin: () => ({ kind: "note", noteId: note.id }),
                      }}
                    >
                      <NoteReader
                        body={note.body}
                        world={world}
                        vaultId={note.vaultId}
                        onOpenLink={openLink}
                        onTag={(tag) => {
                          setQuery(`#${tag}`);
                          if (layout === "narrow") choosePane("library");
                        }}
                      />
                    </SelectableText>
                  </div>
                </ScrollArea>
              )}
            </div>
            {details && layout === "wide" ? (
              <div className="flex w-72 shrink-0 flex-col border-s">{renderDetails()}</div>
            ) : null}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-5 py-12">
            <section aria-labelledby="notes-empty" className="w-full max-w-[27.5rem]">
              <h2 id="notes-empty" className="text-sm leading-5 font-medium">
                {listNotes.length ? t("emptyOpen") : t("emptyTitle")}
              </h2>
              <p className="mt-1 text-[0.8125rem] leading-5 text-pretty text-muted-foreground">
                {listNotes.length ? t("emptyOpenBody") : t("emptyBody")}
              </p>
              <Button type="button" className="mt-5" size="sm" onClick={() => void newNote()}>
                <Icon icon={Add01Icon} size={16} />
                {t("new")}
              </Button>
            </section>
          </div>
        )}
      </div>
      </div>

      <NoteSwitcher
        open={switcher}
        onOpenChange={setSwitcher}
        notes={world.notes}
        vaultLabel={vaultLabel}
        onOpen={(id) => open(id)}
        onCreate={(title) => void newNote(title)}
      />
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
    </div>
  );
}

/** Obsidian's inline title: rename the note where you read its name. */
function NoteTitle({
  note,
  autoFocus,
  onDone,
}: {
  note: Note;
  autoFocus: boolean;
  /** Enter was pressed: the name is kept and the text is next. */
  onDone: () => void;
}) {
  const { t } = useTranslation("notes");
  // Keyed by id and title, so a rename elsewhere starts it afresh.
  const [title, setTitle] = useState(note.title);
  const commit = async () => {
    const wanted = title.trim();
    if (!wanted || wanted === note.title) return setTitle(note.title);
    const got = await renameNote(note.id, wanted);
    setTitle(got);
  };
  return (
    <input
      id="note-title"
      aria-label={t("titleLabel")}
      autoFocus={autoFocus}
      onFocus={(event) => autoFocus && event.currentTarget.select()}
      value={title}
      onChange={(event) => setTitle(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.currentTarget.blur();
          onDone();
        } else if (event.key === "Escape") {
          setTitle(note.title);
          event.currentTarget.blur();
        }
      }}
      dir="auto"
      className="mx-auto w-full max-w-[46rem] truncate bg-transparent px-6 pt-6 text-3xl font-bold tracking-tight outline-none placeholder:text-muted-foreground max-sm:text-2xl"
      placeholder={t("untitled")}
    />
  );
}

/** The editor for one note, saving what is typed a moment after typing stops. */
function EditorPane({
  note,
  editorRef,
  world,
  resolves,
  onOpenLink,
}: {
  note: Note;
  editorRef: React.Ref<NoteEditorHandle>;
  world: () => CompletionWorld;
  resolves: (link: NoteLink) => boolean;
  onOpenLink: (link: NoteLink) => void;
}) {
  const { t } = useTranslation("notes");
  const pending = useRef<{ id: string; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next) void saveNoteBody(next.id, next.text);
  }, []);

  // Switching notes or leaving the page saves what is waiting.
  useEffect(() => flush, [note.id, flush]);
  useEffect(() => {
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [flush]);

  return (
    <NoteEditor
      ref={editorRef}
      docId={note.id}
      value={note.body}
      label={t("editorLabel")}
      placeholder={t("placeholder")}
      world={world}
      resolves={resolves}
      onOpenLink={onOpenLink}
      onChange={(text) => {
        pending.current = { id: note.id, text };
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, 400);
      }}
    />
  );
}
