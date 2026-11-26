import { describe, expect, it } from "vitest";
import type { Folder, Notebook } from "@/lib/db/types";
import {
  activeNavItem,
  addTarget,
  afterVaultSwitch,
  buildNotebookTree,
  foldersAbove,
  isActive,
  monogram,
  pinnedNotebooks,
  sidebarLayout,
  vaultStats,
  type TreeNode,
} from "./nav-model";

const folder = (id: string, name: string, parentId: string | null = null): Folder => ({
  id,
  name,
  parentId,
  createdAt: 0,
  updatedAt: 0,
});
const notebook = (id: string, title: string, extra: Partial<Notebook> = {}): Notebook => ({
  id,
  title,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

/** The tree as indented names, to compare at a glance. */
const outline = (nodes: TreeNode[]): string[] =>
  nodes.flatMap((node) =>
    node.kind === "folder"
      ? [`${"  ".repeat(node.depth)}${node.folder.name}/`, ...outline(node.children)]
      : [`${"  ".repeat(node.depth)}${node.notebook.title}`],
  );

describe("activeNavItem", () => {
  it("reads the Study sections, Collection and the old tab names as their entries", () => {
    expect(activeNavItem("/", "?view=study")).toEqual({ kind: "today" });
    expect(activeNavItem("/", "?view=study&tab=practice")).toEqual({ kind: "practice" });
    expect(activeNavItem("/", "?view=study&tab=collection&filter=cards")).toEqual({ kind: "review" });
    expect(activeNavItem("/", "?view=study&tab=tutor")).toEqual({ kind: "practice" });
    expect(activeNavItem("/study", "?tab=library")).toEqual({ kind: "library" });
  });

  it("reads Recent as its own entry, apart from Notebooks", () => {
    expect(activeNavItem("/", "?view=recents")).toEqual({ kind: "recent" });
    expect(isActive(activeNavItem("/", "?view=recents"), { kind: "recent" })).toBe(true);
    expect(isActive(activeNavItem("/", "?view=recents"), { kind: "notebooks" })).toBe(false);
    expect(isActive(activeNavItem("/", ""), { kind: "recent" })).toBe(false);
  });

  it("reads the notebooks list and its folders as Notebooks", () => {
    expect(activeNavItem("/", "")).toEqual({ kind: "notebooks" });
    expect(activeNavItem("/", "?folder=f1")).toEqual({ kind: "notebooks" });
    expect(activeNavItem("/", "?view=vault")).toEqual({ kind: "notebooks" });
  });

  it("reads Notes, the tools and a notebook", () => {
    expect(activeNavItem("/", "?view=notes&note=n1")).toEqual({ kind: "notes" });
    expect(activeNavItem("/", "?view=skills")).toEqual({ kind: "skills" });
    expect(activeNavItem("/notebook/abc", "?tab=chat")).toEqual({ kind: "notebook", id: "abc" });
  });

  it("is none of them elsewhere", () => {
    expect(activeNavItem("/oauth/callback", "")).toBeNull();
    expect(activeNavItem("/", "?view=unknown")).toBeNull();
  });
});

describe("isActive", () => {
  it("matches a notebook by its id", () => {
    expect(isActive({ kind: "notebook", id: "a" }, { kind: "notebook", id: "a" })).toBe(true);
    expect(isActive({ kind: "notebook", id: "a" }, { kind: "notebook", id: "b" })).toBe(false);
    expect(isActive(null, { kind: "today" })).toBe(false);
  });
});

describe("pinnedNotebooks", () => {
  it("lists every pinned notebook by name, including those inside folders", () => {
    const pinned = pinnedNotebooks([
      notebook("n1", "Zebra", { pinned: true }),
      notebook("n2", "Loose"),
      notebook("n3", "apple", { pinned: true, folderId: "f1" }),
    ]);
    expect(pinned.map(({ title }) => title)).toEqual(["apple", "Zebra"]);
    expect(pinnedNotebooks([notebook("n4", "None")])).toEqual([]);
  });
});

describe("buildNotebookTree", () => {
  it("lists folders first, then pinned notebooks, each by name", () => {
    const tree = buildNotebookTree(
      [folder("f2", "School"), folder("f1", "Archive"), folder("f3", "Biology", "f2")],
      [
        notebook("n1", "Zebra"),
        notebook("n2", "apple"),
        notebook("n3", "Pinned one", { pinned: true }),
        notebook("n4", "Cells", { folderId: "f3" }),
        notebook("n5", "Timetable", { folderId: "f2" }),
      ],
    );
    expect(outline(tree)).toEqual([
      "Archive/",
      "School/",
      "  Biology/",
      "    Cells",
      "  Timetable",
      "Pinned one",
      "apple",
      "Zebra",
    ]);
  });

  it("keeps notebooks and folders whose folder is gone at the top level", () => {
    const tree = buildNotebookTree(
      [folder("f1", "Orphan", "missing")],
      [notebook("n1", "Lost", { folderId: "missing" })],
    );
    expect(outline(tree)).toEqual(["Orphan/", "Lost"]);
  });

  it("puts folders that contain each other at the top level instead of looping", () => {
    const tree = buildNotebookTree([folder("a", "A", "b"), folder("b", "B", "a")], []);
    expect(outline(tree)).toEqual(["A/", "B/"]);
  });
});

describe("foldersAbove", () => {
  it("lists the folders around a notebook, nearest first", () => {
    const folders = [folder("f1", "School"), folder("f2", "Biology", "f1")];
    expect(foldersAbove("n", folders, [notebook("n", "Cells", { folderId: "f2" })])).toEqual(["f2", "f1"]);
    expect(foldersAbove("n", folders, [notebook("n", "Loose")])).toEqual([]);
  });
});

describe("sidebarLayout", () => {
  it("is a drawer on phones, a rail on mid widths and in full on wide screens", () => {
    expect(sidebarLayout({ medium: false, wide: false, collapsed: false })).toBe("drawer");
    expect(sidebarLayout({ medium: false, wide: false, collapsed: true })).toBe("drawer");
    expect(sidebarLayout({ medium: true, wide: false, collapsed: false })).toBe("rail");
    expect(sidebarLayout({ medium: true, wide: true, collapsed: false })).toBe("full");
    expect(sidebarLayout({ medium: true, wide: true, collapsed: true })).toBe("rail");
  });
});

describe("monogram", () => {
  it("is the name's first letter, in capitals", () => {
    expect(monogram("my vault")).toBe("M");
    expect(monogram("  élan")).toBe("É");
    expect(monogram("")).toBe("·");
  });
});

describe("afterVaultSwitch", () => {
  it("leaves a notebook of the old vault for the notebooks list", () => {
    expect(afterVaultSwitch("/notebook/abc", "?tab=chat")).toBe("/");
  });

  it("keeps the section and drops what names one record", () => {
    expect(afterVaultSwitch("/", "?folder=f1")).toBe("/");
    expect(afterVaultSwitch("/", "?view=study&tab=library&book=b1&vault=v1")).toBe("/?view=study&tab=library");
    expect(afterVaultSwitch("/", "?view=notes&note=n1")).toBe("/?view=notes");
  });

  it("stays when nothing would change", () => {
    expect(afterVaultSwitch("/", "")).toBeNull();
    expect(afterVaultSwitch("/", "?view=study&tab=review")).toBeNull();
  });
});

describe("addTarget", () => {
  const notebooks = [
    notebook("old", "Old", { updatedAt: 1 }),
    notebook("new", "New", { updatedAt: 5 }),
    notebook("other", "Elsewhere", { updatedAt: 9, vaultId: "v2" }),
  ];

  it("offers the open notebook first, else the vault's last changed", () => {
    expect(addTarget(notebooks, "default", "old")).toBe("old");
    expect(addTarget(notebooks, "default")).toBe("new");
    expect(addTarget(notebooks, "v2")).toBe("other");
    expect(addTarget(notebooks, "v3")).toBeUndefined();
  });
});

describe("vaultStats", () => {
  it("counts each vault's notebooks and what is due in it", () => {
    const rows = [
      { id: "c1", kind: "card", vaultId: "default" },
      { id: "c2", kind: "card", vaultId: "v2" },
      { id: "c3", kind: "card", vaultId: "v2" },
    ] as unknown as Parameters<typeof vaultStats>[0]["rows"];
    const stats = vaultStats({
      vaults: [{ id: "default" }, { id: "v2" }],
      notebooks: [{}, {}, { vaultId: "v2" }],
      rows,
      owner: (row) => (row as { vaultId: string }).vaultId,
      dueCount: (review) => review.length,
      current: "default",
      acrossVaults: false,
    });
    expect(stats.get("default")).toEqual({ notebooks: 2, due: 1 });
    expect(stats.get("v2")).toEqual({ notebooks: 1, due: 2 });
  });

  it("lets the current vault's count read the others when Review does", () => {
    const rows = [
      { id: "c1", kind: "card", vaultId: "default" },
      { id: "c2", kind: "card", vaultId: "v2" },
    ] as unknown as Parameters<typeof vaultStats>[0]["rows"];
    const stats = vaultStats({
      vaults: [{ id: "default" }, { id: "v2" }],
      notebooks: [],
      rows,
      owner: (row) => (row as { vaultId: string }).vaultId,
      dueCount: (review) => review.length,
      current: "default",
      acrossVaults: true,
    });
    expect(stats.get("default")?.due).toBe(2);
    expect(stats.get("v2")?.due).toBe(1);
  });
});
