import type { Folder, Notebook, Vault } from "@/lib/db/types";
import type { StudyRecord } from "@/lib/study/records";
import { studyVaultViews } from "@/lib/study/review-vaults";
import { DEFAULT_VAULT } from "@/lib/study/vault";

/** The entries of the app sidebar that a page can be. */
export type NavItem =
  | { kind: "today" | "practice" | "review" | "library" }
  | { kind: "notebooks" | "recent" }
  | { kind: "notes" | "calendar" | "bot" | "skills" }
  | { kind: "notebook"; id: string };

/** Today's study tabs and the sidebar entry each belongs to. Collection is Review's deck. */
const studyEntries: Record<string, "today" | "practice" | "review" | "library"> = {
  today: "today",
  practice: "practice",
  tutor: "practice",
  review: "review",
  collection: "review",
  cards: "review",
  highlights: "review",
  vocabulary: "review",
  library: "library",
};

/**
 * Which sidebar entry the page at this address is, or null when it is none of
 * them. The home page's sections are told apart by `?view=` (and `?tab=` for
 * Study); a notebook by its path.
 */
export function activeNavItem(pathname: string, search: string): NavItem | null {
  const notebook = /^\/notebook\/([^/]+)/.exec(pathname);
  if (notebook) return { kind: "notebook", id: decodeURIComponent(notebook[1]) };
  if (pathname === "/study") return studyItem(new URLSearchParams(search).get("tab"));
  if (pathname !== "/") return null;
  const params = new URLSearchParams(search);
  const view = params.get("view");
  switch (view) {
    case "study":
      return studyItem(params.get("tab"));
    case "notes":
    case "calendar":
    case "bot":
    case "skills":
      return { kind: view };
    case "recents":
      return { kind: "recent" };
    case null:
    case "all":
    case "vault":
      return { kind: "notebooks" };
    default:
      return null;
  }
}

function studyItem(tab: string | null): NavItem {
  return { kind: studyEntries[tab ?? ""] ?? "today" };
}

export function isActive(active: NavItem | null, item: NavItem): boolean {
  if (!active || active.kind !== item.kind) return false;
  return active.kind !== "notebook" || (item.kind === "notebook" && active.id === item.id);
}

/** A folder of the sidebar's tree, with what is in it. */
export interface FolderNode {
  kind: "folder";
  folder: Folder;
  depth: number;
  children: TreeNode[];
}

export interface NotebookNode {
  kind: "notebook";
  notebook: Notebook;
  depth: number;
}

export type TreeNode = FolderNode | NotebookNode;

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

/**
 * The vault's notebooks as a tree of folders: at each level folders first,
 * by name, then notebooks, pinned ones first, each group by name. A folder
 * whose parent is missing (or that would loop) sits at the top level, and so
 * does a notebook whose folder is gone.
 */
export function buildNotebookTree(folders: readonly Folder[], notebooks: readonly Notebook[]): TreeNode[] {
  const ids = new Set(folders.map(({ id }) => id));
  const parentOf = (folder: Folder) => {
    const parent = folder.parentId ?? null;
    if (!parent || !ids.has(parent)) return null;
    return reachesItself(folder, folders) ? null : parent;
  };
  const build = (parent: string | null, depth: number, seen: Set<string>): TreeNode[] => {
    const childFolders = folders
      .filter((folder) => parentOf(folder) === parent && !seen.has(folder.id))
      .sort((a, b) => byName(a.name, b.name));
    const childNotebooks = notebooks
      .filter((notebook) => {
        const folder = notebook.folderId ?? null;
        return (folder && ids.has(folder) ? folder : null) === parent;
      })
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || byName(a.title, b.title));
    return [
      ...childFolders.map((folder): FolderNode => ({
        kind: "folder",
        folder,
        depth,
        children: build(folder.id, depth + 1, new Set([...seen, folder.id])),
      })),
      ...childNotebooks.map((notebook): NotebookNode => ({ kind: "notebook", notebook, depth })),
    ];
  };
  return build(null, 0, new Set());
}

/** The vault's pinned notebooks by name, wherever they sit in folders. */
export function pinnedNotebooks(notebooks: readonly Notebook[]): Notebook[] {
  return notebooks.filter(({ pinned }) => pinned).sort((a, b) => byName(a.title, b.title));
}

function reachesItself(folder: Folder, folders: readonly Folder[]) {
  const byId = new Map(folders.map((each) => [each.id, each]));
  const seen = new Set<string>([folder.id]);
  for (let at = folder.parentId ? byId.get(folder.parentId) : undefined; at; ) {
    if (seen.has(at.id)) return true;
    seen.add(at.id);
    at = at.parentId ? byId.get(at.parentId) : undefined;
  }
  return false;
}

/** The folders that hold a notebook, so the tree can open down to it. */
export function foldersAbove(notebookId: string, folders: readonly Folder[], notebooks: readonly Notebook[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: string[] = [];
  const seen = new Set<string>();
  let at = notebooks.find(({ id }) => id === notebookId)?.folderId ?? null;
  while (at && byId.has(at) && !seen.has(at)) {
    seen.add(at);
    path.push(at);
    at = byId.get(at)?.parentId ?? null;
  }
  return path;
}

/** How the sidebar is drawn: in a drawer on phones, as icons on mid widths or when collapsed, else in full. */
export type SidebarLayout = "drawer" | "rail" | "full";

export function sidebarLayout({
  medium,
  wide,
  collapsed,
}: {
  /** At least 768px wide. */
  medium: boolean;
  /** At least 1280px wide. */
  wide: boolean;
  collapsed: boolean;
}): SidebarLayout {
  if (!medium) return "drawer";
  return wide && !collapsed ? "full" : "rail";
}

/** The letter of a vault's monogram. */
export function monogram(name: string) {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase() : "·";
}

/**
 * Where to go after switching vault, or null to stay. A notebook belongs to
 * the vault left, so its page gives way to the notebooks list; anything that
 * names one record (a folder, a book, a note, a thread) is dropped, so the
 * page shows the same section of the new vault.
 */
export function afterVaultSwitch(pathname: string, search: string): string | null {
  if (pathname.startsWith("/notebook/")) return "/";
  if (pathname !== "/") return null;
  const params = new URLSearchParams(search);
  const view = params.get("view");
  const keep = new URLSearchParams();
  if (view) keep.set("view", view);
  if (view === "study" && params.get("tab")) keep.set("tab", params.get("tab") ?? "");
  if (keep.toString() === params.toString()) return null;
  const query = keep.toString();
  return query ? `/?${query}` : "/";
}

/** The notebook Add offers first: the open one, else the one changed last in the vault. */
export function addTarget(
  notebooks: readonly Notebook[],
  vaultId: string,
  open?: string,
): string | undefined {
  if (open && notebooks.some(({ id }) => id === open)) return open;
  return notebooks
    .filter((notebook) => (notebook.vaultId ?? DEFAULT_VAULT) === vaultId)
    .reduce<Notebook | undefined>((last, each) => (!last || each.updatedAt > last.updatedAt ? each : last), undefined)
    ?.id;
}

export interface VaultStats {
  notebooks: number;
  /** Cards, words and highlights due for review now. */
  due: number;
}

/**
 * How many notebooks each vault holds and how much in it is due, as the
 * vault switcher and the sidebar's Review count show them. `due` counts the
 * rows `owner` places in the vault; with `acrossVaults` (the Review setting)
 * the current vault's count also reads the others, as Review does.
 */
export function vaultStats({
  vaults,
  notebooks,
  rows,
  owner,
  dueCount,
  current,
  acrossVaults,
}: {
  vaults: readonly Pick<Vault, "id">[];
  notebooks: readonly Pick<Notebook, "vaultId">[];
  rows: readonly StudyRecord[];
  owner: (row: StudyRecord) => string;
  dueCount: (rows: StudyRecord[]) => number;
  current: string;
  acrossVaults: boolean;
}): Map<string, VaultStats> {
  const stats = new Map<string, VaultStats>();
  for (const { id } of vaults) {
    const views = studyVaultViews(rows, owner, id, acrossVaults && id === current);
    stats.set(id, {
      notebooks: notebooks.filter((notebook) => (notebook.vaultId ?? DEFAULT_VAULT) === id).length,
      due: dueCount(views.review),
    });
  }
  return stats;
}
