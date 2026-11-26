import { Folder01Icon, MoreHorizontalIcon, PinIcon } from "@hugeicons/core-free-icons";
import { useState, type DragEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { MenuActions, type MenuAction } from "@/components/common/action-menu";
import { ContextMenu, ContextMenuTrigger } from "@/components/common/context-menu";
import { Icon } from "@/components/icon";
import { Menu } from "@/components/panelui/menu";
import type { Folder, Notebook, Vault } from "@/lib/db/database";
import { formatRelativeTime } from "@/lib/format";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { fileKindOf, type FileKind } from "@/lib/files/kinds";
import { downloadVaultFile } from "@/lib/db/files";
import type { VaultFile } from "@/lib/db/types";
import { notebookIcon } from "@/lib/notebooks/icons";
import { sourceFormatIcons } from "@/components/sources/source-format";
import { useFileActions, useFolderActions, useNotebookActions } from "./item-actions";
import { documentSummary } from "./notebook-list";
import { FileArt, FolderArt, KindBadge, TileName } from "./vault-tiles";

/** Drag types for moving notebooks and folders; files use the browser's own "Files". */
export const NOTEBOOK_DRAG = "application/x-better-vault-notebook";
export const FOLDER_DRAG = "application/x-better-vault-folder";
export const FILE_DRAG = "application/x-better-vault-file";

export const isFileDrag = (event: DragEvent) => event.dataTransfer.types.includes("Files");
export const isCardDrag = (event: DragEvent) =>
  event.dataTransfer.types.includes(NOTEBOOK_DRAG) ||
  event.dataTransfer.types.includes(FOLDER_DRAG) ||
  event.dataTransfer.types.includes(FILE_DRAG);

export type HomeView = "grid" | "list";

/** Props to make an element take dropped notebooks and folders, with a highlight while over it. */
export function useDropTarget(onDropCards: (event: DragEvent) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (event: DragEvent) => {
        if (!isCardDrag(event)) return;
        event.preventDefault();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (event: DragEvent) => {
        if (!isCardDrag(event)) return;
        event.preventDefault();
        setOver(false);
        onDropCards(event);
      },
    },
  };
}

/**
 * The notebook's book tile, as on its overview: a neutral cover with the
 * name's first letter in the reading serif.
 */
function BookTile({ title, size }: { title: string; size: "sm" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-end bg-background font-serif font-semibold text-foreground/90 inset-ring inset-ring-border [font-optical-sizing:auto]",
        size === "sm"
          ? "h-12 w-9 rounded-sm ps-1.5 pb-1 text-[1.0625rem] leading-5"
          : "h-28 w-21 rounded-md ps-3 pb-2.5 text-[2rem] leading-9",
      )}
    >
      {Array.from(title.trim())[0]?.toLocaleUpperCase() ?? ""}
    </span>
  );
}

function FolderTile({ size }: { size: "sm" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center bg-muted text-muted-foreground inset-ring inset-ring-border",
        size === "sm" ? "h-12 w-9 rounded-sm" : "h-28 w-21 rounded-md",
      )}
    >
      <Icon icon={Folder01Icon} size={size === "sm" ? 18 : 28} strokeWidth={1.5} />
    </span>
  );
}

/** A loose file's row mark: its format's badge on a neutral sheet. */
function FileTile({ kind }: { kind: FileKind }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-12 w-9 shrink-0 items-center justify-center rounded-sm bg-background inset-ring inset-ring-border"
    >
      <KindBadge kind={kind} className="size-6" />
    </span>
  );
}

/**
 * A list row: hairline above, the whole row a link, its menu at the end. In
 * Tiles, folders, notebooks and files are the vault's frosted folder and paper
 * tiles (vault-tiles.tsx), with badges for the kinds of file they hold.
 */
const rowClass =
  "group relative -mx-2 flex min-h-19 items-center gap-4 rounded-[10px] border-t px-2 py-3 transition-colors duration-150 hover:bg-foreground/[0.04] focus-within:bg-foreground/[0.04]";
const tileClass =
  "group relative flex flex-col items-center gap-2.5 rounded-xl px-2 pt-4 pb-3 text-center transition-colors duration-150 hover:bg-foreground/[0.04] focus-within:bg-foreground/[0.04]";
/** A link or button covering its row, so the row opens with one target and keeps its menu clickable. */
const coverClass =
  "absolute inset-0 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:ring-inset";

export function FolderItem({
  folder,
  folders,
  size,
  kinds,
  view,
  onOpen,
  onDropCards,
}: {
  folder: Folder;
  folders: Folder[];
  size: number;
  /** The kinds of file inside it, most common first. */
  kinds: FileKind[];
  view: HomeView;
  onOpen: () => void;
  onDropCards: (event: DragEvent) => void;
}) {
  const { t, i18n } = useTranslation("home");
  const { t: tShell } = useTranslation("shell");
  const drop = useDropTarget(onDropCards);
  const meta = t("folders.items", { count: size });
  const { actions, dialogs, onKeyDown } = useFolderActions(folder, folders, onOpen);
  const menu = <CardMenu label={tShell("list.menu", { name: folder.name })} actions={actions} />;
  const common = {
    onKeyDown,
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData(FOLDER_DRAG, folder.id);
      event.dataTransfer.effectAllowed = "move";
    },
    ...drop.props,
  };
  const open = <button type="button" onClick={onOpen} aria-label={folder.name} className={cn(coverClass, "cursor-pointer")} />;
  const over = drop.over && "bg-muted ring-1 ring-muted-foreground";

  if (view === "list")
    return (
      <WithContextMenu actions={actions} dialogs={dialogs}>
        <div {...common} className={cn(rowClass, over)}>
          {open}
          <FolderTile size="sm" />
          <span className="pointer-events-none flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm font-medium">{folder.name}</span>
            <span className="truncate text-[0.8125rem] leading-5 text-muted-foreground tabular-nums">
              {meta} · {tShell("list.changed", { time: formatRelativeTime(folder.updatedAt, i18n.language) })}
            </span>
          </span>
          {menu}
        </div>
      </WithContextMenu>
    );

  return (
    <WithContextMenu actions={actions} dialogs={dialogs}>
      <div {...common} className={cn(tileClass, over)}>
        {open}
        <span className="pointer-events-none w-full">
          <FolderArt kinds={kinds} count={size} tint={folder.color} />
        </span>
        <span className="pointer-events-none w-full min-w-0">
          <TileName name={folder.name} />
          <span className="block truncate text-xs text-muted-foreground tabular-nums">{meta}</span>
        </span>
        <span className="absolute end-1.5 top-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 has-[[data-popup-open]]:opacity-100 max-md:opacity-100">
          {menu}
        </span>
      </div>
    </WithContextMenu>
  );
}

export function NotebookItem({
  notebook,
  folders,
  vaults,
  sources,
  kinds,
  titles = [],
  progress,
  where,
  view,
  book = false,
}: {
  notebook: Notebook;
  folders: Folder[];
  /** The vaults it can be moved to. */
  vaults: Vault[];
  sources: number;
  /** The kinds of its sources, most common first. */
  kinds: FileKind[];
  /** Its documents' titles, the first of which the row names. */
  titles?: readonly string[];
  /** One quiet sentence on how far it has got, if anything is known. */
  progress?: string;
  /** The folder it is in, shown in search results. */
  where?: string;
  view: HomeView;
  /** It was made to hold one document added in Study. */
  book?: boolean;
}) {
  const { t, i18n } = useTranslation("home");
  const { t: tShell } = useTranslation("shell");
  const documents = sources ? tShell("list.documents", { count: sources }) : tShell("list.noDocuments");
  const summary = documentSummary(titles);
  const changed = tShell("list.changed", { time: formatRelativeTime(notebook.updatedAt, i18n.language) });
  const { actions, dialogs, onKeyDown } = useNotebookActions(notebook, folders, vaults);
  const menu = <CardMenu label={tShell("list.menu", { name: notebook.title })} actions={actions} />;
  const common = {
    onKeyDown,
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData(NOTEBOOK_DRAG, notebook.id);
      event.dataTransfer.effectAllowed = "move";
    },
  };
  const open = (
    <Link
      to={routes.notebook(notebook.id)}
      draggable={false}
      aria-label={notebook.title}
      className={coverClass}
    />
  );
  const badge = book ? (
    <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-input px-2 text-xs text-muted-foreground">
      {t("bookBadge")}
    </span>
  ) : null;
  const pin = notebook.pinned ? (
    <>
      <Icon icon={PinIcon} size={12} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
      <span className="sr-only">{tShell("nav.pinned")}</span>
    </>
  ) : null;

  if (view === "list")
    return (
      <WithContextMenu actions={actions} dialogs={dialogs}>
        <div {...common} className={rowClass}>
          {open}
          <BookTile title={notebook.title} size="sm" />
          <span className="pointer-events-none flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2">
              {pin}
              <span className="truncate text-sm font-medium" dir="auto">
                {notebook.title}
              </span>
              {badge}
            </span>
            <span className="truncate text-[0.8125rem] leading-5 text-muted-foreground">
              <span className="text-foreground/90 tabular-nums">{documents}</span>
              {summary ? ` · ${summary}` : ""}
            </span>
            <span className="truncate text-xs text-muted-foreground tabular-nums">
              {[where && tShell("list.inFolder", { folder: where }), progress, changed]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          {menu}
        </div>
      </WithContextMenu>
    );

  return (
    <WithContextMenu actions={actions} dialogs={dialogs}>
      <div {...common} className={tileClass}>
        {open}
        <span className="pointer-events-none w-full">
          <FolderArt
            kinds={kinds}
            count={sources}
            tint={notebook.color}
            mark={notebookIcon(notebook.icon)}
          />
        </span>
        <span className="pointer-events-none w-full min-w-0">
          <span className="flex min-w-0 items-center justify-center gap-1.5" dir="auto">
            {pin}
            <TileName name={notebook.title} />
          </span>
          <span className="block truncate text-xs text-muted-foreground tabular-nums" title={changed}>
            {progress ?? documents}
          </span>
        </span>
        <span className="absolute end-1.5 top-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 has-[[data-popup-open]]:opacity-100 max-md:opacity-100">
          {menu}
        </span>
      </div>
    </WithContextMenu>
  );
}

/** A loose file in the vault: a sheet of paper; opening it downloads it. */
export function FileItem({
  file,
  folders,
  view,
}: {
  file: VaultFile;
  folders: Folder[];
  view: HomeView;
}) {
  const { t, i18n } = useTranslation("home");
  const { t: tShell } = useTranslation("shell");
  const { t: tSources } = useTranslation("sources");
  const kind = fileKindOf(file.name, file.mime);
  const kindLabel =
    kind in sourceFormatIcons
      ? tSources(`formats.${kind}` as "formats.pdf")
      : t(`files.kinds.${kind}` as "files.kinds.other");
  const meta = t("files.size", { kind: kindLabel, size: formatBytes(file.size, i18n.language) });
  const { actions, dialogs, onKeyDown } = useFileActions(file, folders);
  const menu = <CardMenu label={tShell("list.menu", { name: file.name })} actions={actions} />;
  const common = {
    onKeyDown,
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData(FILE_DRAG, file.id);
      event.dataTransfer.effectAllowed = "move";
    },
  };
  const open = (
    <button
      type="button"
      onClick={() => void downloadVaultFile(file)}
      aria-label={file.name}
      className={cn(coverClass, "cursor-pointer")}
    />
  );
  const title = file.name.replace(/\.[^.]+$/, "");

  if (view === "list")
    return (
      <WithContextMenu actions={actions} dialogs={dialogs}>
        <div {...common} className={rowClass}>
          {open}
          <FileTile kind={kind} />
          <span className="pointer-events-none flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm font-medium" dir="auto">
              {file.name}
            </span>
            <span className="truncate text-[0.8125rem] leading-5 text-muted-foreground tabular-nums">
              {meta} · {tShell("list.changed", { time: formatRelativeTime(file.updatedAt, i18n.language) })}
            </span>
          </span>
          {menu}
        </div>
      </WithContextMenu>
    );

  return (
    <WithContextMenu actions={actions} dialogs={dialogs}>
      <div {...common} className={tileClass}>
        {open}
        <span className="pointer-events-none w-full">
          <FileArt kind={kind} />
        </span>
        <span className="pointer-events-none w-full min-w-0">
          <TileName name={title} />
          <span className="block truncate text-xs text-muted-foreground tabular-nums">{meta}</span>
        </span>
        <span className="absolute end-1.5 top-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 has-[[data-popup-open]]:opacity-100 max-md:opacity-100">
          {menu}
        </span>
      </div>
    </WithContextMenu>
  );
}

function formatBytes(bytes: number, language: string) {
  const units = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return new Intl.NumberFormat(language, {
    style: "unit",
    unit: units[unit],
    unitDisplay: "short",
    maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0,
  }).format(value);
}

/** The card's "⋯" menu: the same actions as its right-click menu. */
function CardMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  return (
    <Menu>
      <Menu.Trigger
        aria-label={label}
        title={label}
        className="relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 data-popup-open:bg-muted data-popup-open:text-foreground max-md:size-11"
      >
        <Icon icon={MoreHorizontalIcon} size={16} strokeWidth={1.5} />
      </Menu.Trigger>
      <Menu.Content align="end">
        <MenuActions actions={actions} />
      </Menu.Content>
    </Menu>
  );
}

/** Wraps a card so a right-click (or the menu key) opens its actions at the pointer. */
function WithContextMenu({
  actions,
  dialogs,
  children,
}: {
  actions: MenuAction[];
  /** Kept outside the trigger, so a right-click inside a dialog doesn't reach the card. */
  dialogs: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger render={<div className="contents" />}>{children}</ContextMenuTrigger>
        <Menu.Content sideOffset={0}>
          <MenuActions actions={actions} />
        </Menu.Content>
      </ContextMenu>
      {dialogs}
    </>
  );
}
