import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  Book02Icon,
  BookmarkRemove01Icon,
  Delete02Icon,
  FileImportIcon,
  MoreHorizontalIcon,
  File02Icon,
  Link01Icon,
  PencilEdit01Icon,
  PodcastIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { RenameDialog } from "@/components/common/rename-dialog";
import { Icon } from "@/components/icon";
import { Button, buttonVariants } from "@/components/panelui/button";
import { Dialog } from "@/components/panelui/dialog";
import { Input } from "@/components/panelui/input";
import { Menu } from "@/components/panelui/menu";
import { AddTranscriptDialog } from "@/components/sources/add-transcript-dialog";
import { useVaultName } from "@/components/home/vault-name";
import { useNotebook } from "@/lib/db/notebooks";
import { renameSource } from "@/lib/db/sources";
import { addStudyBook, renameStudyBook, studyBookForSource } from "@/lib/db/study";
import type { SourceSummary } from "@/lib/db/types";
import { currentVaultId, useVaults } from "@/lib/db/vaults";
import { routes } from "@/lib/routes";
import { studyHref } from "@/lib/study/links";
import { readStudyFile } from "@/lib/study/read-file";
import { studyReadingProgress } from "@/lib/study/reading-progress";
import { studyDocumentContent } from "@/lib/study/markdown-document";
import { studyDocumentDraftId } from "@/lib/study/document-drafts";
import { studyLibraryEntries, type StudyLibraryEntry } from "@/lib/study/library";
import {
  countBy,
  filterLibraryEntries,
  libraryEntryType,
  sortLibraryEntries,
  type LibraryType,
} from "@/lib/study/library-list";
import type {
  StudyBook,
  StudyDocumentRecovery,
  StudyDocumentSnapshot,
  StudyRecordOf,
} from "@/lib/study/records";
import { cn } from "@/lib/utils";
import { StudyProgressBar } from "./study-book-cover";
import { StudyDocumentRemovalDialog, type StudyDocumentRemoval } from "./study-document-dialogs";
import { StudyDocumentEditor } from "./study-document-editor";
import { useStudyDocumentRecovery } from "./study-document-recovery";
import {
  chosenNotebook,
  StudyNotebookField,
  type StudyNotebookChoice,
} from "./study-notebook-field";

const studyFileTypes = /\.(pdf|epub|txt|text|md|markdown|mdx)$/i;
const studyMimeTypes = new Set([
  "application/pdf",
  "application/epub+zip",
  "text/plain",
  "text/markdown",
]);
const isStudyFile = (file: File) => studyFileTypes.test(file.name) || studyMimeTypes.has(file.type);

type Entry = StudyLibraryEntry<StudyBook>;

export function StudyLibrary({
  books,
  sources,
  highlights,
  notebookTitles,
  notebookId,
  vaultId,
  openBook,
}: {
  books: StudyBook[];
  /** The readable sources of the notebooks shown, without their text; `undefined` while loading. */
  sources: SourceSummary[] | undefined;
  highlights: StudyRecordOf<"highlight">[];
  notebookTitles: ReadonlyMap<string, string>;
  notebookId: string | null;
  vaultId: string;
  openBook: (book: StudyBook) => void;
}) {
  const { t } = useTranslation("home");
  const { t: tNotes } = useTranslation("notes");
  const { t: tCommon } = useTranslation();
  const { t: tSources } = useTranslation("sources");
  const input = useRef<HTMLInputElement>(null);
  const openingSource = useRef<AbortController>(null);
  const shelvesId = useId();
  const vaultName = useVaultName();
  const vaultLabel = vaultName(useVaults()?.find(({ id }) => id === vaultId) ?? { name: "" });
  const [search, setSearch] = useState("");
  const [notebookFilter, setNotebookFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<LibraryType | "all">("all");
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<string>();
  const [removing, setRemoving] = useState<StudyDocumentRemoval | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [drafting, setDrafting] = useState<string>();
  const [addingMedia, setAddingMedia] = useState<string>();
  const [mediaNotebook, setMediaNotebook] = useState<StudyNotebookChoice>("");
  const [choosing, setChoosing] = useState<{ vaultId: string; files: File[] } | null>(null);
  const [dragging, setDragging] = useState(false);
  const recovery = useStudyDocumentRecovery({ id: studyDocumentDraftId({ vaultId }), vaultId });
  const entries = useMemo(
    () => sortLibraryEntries(studyLibraryEntries(books, sources)),
    [books, sources],
  );
  const query = search.trim().toLowerCase();
  const notebookCounts = useMemo(() => countBy(entries, (entry) => entry.notebookId), [entries]);
  const typeCounts = useMemo(() => countBy(entries, libraryEntryType), [entries]);
  const notebookChoices = [...notebookCounts.keys()].map(
    (id) => [id, notebookTitles.get(id) ?? t("study.library.unknownNotebook")] as const,
  );
  const typeChoices = [...typeCounts.keys()];
  const filtered = Boolean(query) || notebookFilter !== "all" || typeFilter !== "all";
  const matches = filterLibraryEntries(
    entries,
    { query, notebook: notebookFilter, type: typeFilter },
    notebookTitles,
  );
  const resume = studyResume(entries, t("study.libraryPage.untitledSection"));

  useEffect(() => () => openingSource.current?.abort(), [notebookId, vaultId]);

  async function readSource(id: string) {
    if (openingSource.current && !openingSource.current.signal.aborted) return;
    const request = new AbortController();
    openingSource.current = request;
    setOpening(id);
    try {
      const book = await studyBookForSource(id);
      if (!request.signal.aborted && currentVaultId() === vaultId) openBook(book);
    } catch (error) {
      if (!request.signal.aborted)
        toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (openingSource.current === request) {
        openingSource.current = null;
        setOpening(undefined);
      }
    }
  }

  async function importBooks(files: File[], notebook?: string) {
    setLoading(true);
    let last: StudyBook | undefined;
    try {
      for (const file of files) {
        try {
          last = await addStudyBook({
            ...(await readStudyFile(file)),
            vaultId,
            notebookId: notebook,
          });
        } catch (error) {
          toast.error(t("study.library.importError", { name: file.name, error: String(error) }));
        }
      }
    } finally {
      setLoading(false);
    }
    if (last && currentVaultId() === vaultId) openBook(last);
  }

  function dropFiles(list: FileList) {
    const files = Array.from(list);
    const accepted = files.filter(isStudyFile);
    for (const file of files)
      if (!accepted.includes(file))
        toast.error(t("study.library.unsupported", { name: file.name }));
    if (accepted.length) chooseNotebook(accepted);
  }

  /** Asks which notebook the files go to before adding them. */
  function chooseNotebook(files: File[]) {
    setChoosing({ vaultId, files });
  }

  const canImport = !notebookId;
  const removingFrom = removing
    ? notebookTitles.get(
        removing.kind === "delete" ? removing.document.notebookId : removing.book.notebookId,
      )
    : undefined;
  const highlightCounts = new Map<string, number>();
  for (const { bookId } of highlights)
    highlightCounts.set(bookId, (highlightCounts.get(bookId) ?? 0) + 1);
  const addMenu = (
    <Menu>
      <Menu.Trigger render={<Button shape="pill" disabled={loading} />}>
        <Icon icon={loading ? FileImportIcon : Add01Icon} />
        {t(loading ? "study.library.importing" : "study.libraryPage.add")}
      </Menu.Trigger>
      <Menu.Content align="end">
        <Menu.Item onClick={() => input.current?.click()}>
          <Icon icon={FileImportIcon} />
          {t("study.libraryPage.addFile")}
        </Menu.Item>
        <Menu.Item disabled={!recovery.ready} onClick={() => setDrafting(vaultId)}>
          <Icon icon={File02Icon} />
          {t(
            recovery.latest?.snapshot?.kind === "new"
              ? "study.documentEditor.resumeNew"
              : "study.library.newText",
          )}
        </Menu.Item>
        <Menu.Item
          onClick={() => {
            setMediaNotebook("");
            setAddingMedia(vaultId);
          }}
        >
          <Icon icon={PodcastIcon} />
          {tSources("transcript.open")}
        </Menu.Item>
      </Menu.Content>
    </Menu>
  );

  return (
    <section
      className="space-y-5"
      aria-labelledby="study-library"
      onDragOver={(event) => {
        if (!canImport || loading || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!canImport || loading || !event.dataTransfer.files.length) return;
        event.preventDefault();
        setDragging(false);
        dropFiles(event.dataTransfer.files);
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="study-library" className="text-2xl font-semibold tracking-tight">
            {t("study.libraryPage.title")}
          </h2>
          <p className="text-sm text-muted-foreground" dir="auto">
            {notebookId
              ? t("study.libraryPage.subtitleNotebook")
              : t("study.libraryPage.subtitle", { vault: vaultLabel })}
          </p>
        </div>
        {notebookId ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`${routes.home}?view=notes`}
              className={buttonVariants({
                variant: "ghost",
                shape: "pill",
                className: "md:hidden",
              })}
            >
              {tNotes("title")}
            </Link>
            {addMenu}
            <input
              ref={input}
              type="file"
              accept=".pdf,.epub,.txt,.text,.md,.markdown,.mdx,application/pdf,application/epub+zip,text/plain,text/markdown"
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                if (files.length) chooseNotebook(files);
              }}
            />
          </div>
        )}
      </div>
      {notebookId ? <NotebookLibraryScope notebookId={notebookId} /> : null}
      {dragging ? (
        <p
          role="status"
          className="rounded-xl border-2 border-dashed border-primary bg-muted/60 px-4 py-6 text-center text-sm font-medium"
        >
          {t("study.library.dropHere")}
        </p>
      ) : null}
      {resume && !filtered ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
          <p className="min-w-0 text-sm" dir="auto">
            <span className="text-muted-foreground">{t("study.libraryPage.leftOff")} </span>
            <span className="font-medium">{resume.where}</span>
            <span className="text-muted-foreground">
              {" · "}
              {resume.title} · {t("study.libraryPage.percentRead", { percent: resume.percent })} ·{" "}
              {t("study.libraryPage.sectionOf", { current: resume.current, total: resume.total })}
            </span>
          </p>
          <Button shape="pill" onClick={() => openBook(resume.book)}>
            {t("study.libraryPage.continue")}
            <Icon icon={ArrowRight01Icon} className="rtl:rotate-180" />
          </Button>
        </div>
      ) : null}
      {entries.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-sm min-w-48 flex-1">
            <Icon
              icon={Search01Icon}
              size={16}
              className="pointer-events-none absolute inset-y-0 start-3 my-auto text-muted-foreground"
            />
            <Input
              type="search"
              className="ps-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("study.libraryPage.search")}
              aria-label={t("study.libraryPage.search")}
            />
          </div>
          {notebookId || notebookChoices.length < 2 ? null : (
            <FilterMenu
              name={t("study.libraryPage.notebook")}
              all={t("study.libraryPage.allNotebooks")}
              value={notebookFilter}
              onChange={setNotebookFilter}
              options={notebookChoices.map(([id, label]) => ({
                value: id,
                label,
                count: notebookCounts.get(id) ?? 0,
              }))}
              total={entries.length}
            />
          )}
          {typeChoices.length < 2 ? null : (
            <FilterMenu
              name={t("study.libraryPage.type")}
              all={t("study.libraryPage.allTypes")}
              value={typeFilter}
              onChange={(value) => setTypeFilter(value as LibraryType | "all")}
              options={typeChoices.map((type) => ({
                value: type,
                label: tSources(`kinds.${type}`),
                count: typeCounts.get(type) ?? 0,
              }))}
              total={entries.length}
            />
          )}
        </div>
      ) : null}
      {entries.length ? (
        <p id={`${shelvesId}-hint`} className="text-xs text-muted-foreground" role="status">
          {filtered
            ? t("study.libraryPage.countFiltered", { shown: matches.length, total: entries.length })
            : t("study.libraryPage.count", { count: entries.length })}
        </p>
      ) : null}
      {matches.length ? (
        <div>
          <div className="hidden grid-cols-[minmax(0,1fr)_11rem_9rem_2rem] gap-4 border-b px-3 pb-2 text-xs font-medium text-muted-foreground sm:grid">
            <span>{t("study.libraryPage.document")}</span>
            <span>{t("study.libraryPage.notebook")}</span>
            <span>{t("study.libraryPage.progress")}</span>
            <span />
          </div>
          <ul className="divide-y">
            {matches.map((entry) => (
              <LibraryRow
                key={`${entry.kind}:${entry.id}`}
                entry={entry}
                notebook={notebookTitles.get(entry.notebookId)}
                highlights={entry.kind === "book" ? (highlightCounts.get(entry.id) ?? 0) : 0}
                opening={opening}
                open={(next) =>
                  next.kind === "book" ? openBook(next.book) : void readSource(next.id)
                }
                rename={setEditing}
                remove={setRemoving}
              />
            ))}
          </ul>
        </div>
      ) : null}
      {sources === undefined && !matches.length ? (
        <p role="status" className="text-sm text-muted-foreground">
          {tCommon("status.loading")}
        </p>
      ) : !matches.length && !entries.length ? (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
            <Icon icon={Book02Icon} size={24} />
          </span>
          <p className="font-semibold">{t("study.libraryPage.emptyTitle")}</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {t(notebookId ? "study.library.emptyNotebook" : "study.libraryPage.emptyBody")}
          </p>
          {canImport ? addMenu : null}
        </div>
      ) : !matches.length ? (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
            <Icon icon={Search01Icon} size={24} />
          </span>
          <p className="font-semibold" dir="auto">
            {query
              ? t("study.libraryPage.noMatchSearch", { query: search.trim() })
              : t("study.libraryPage.noMatchFilters")}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {t("study.libraryPage.noMatchHint")}
          </p>
          <Button
            shape="pill"
            variant="outline"
            onClick={() => {
              setSearch("");
              setNotebookFilter("all");
              setTypeFilter("all");
            }}
          >
            {t(
              query && (notebookFilter !== "all" || typeFilter !== "all")
                ? "study.libraryPage.clearBoth"
                : query
                  ? "study.libraryPage.clearSearch"
                  : "study.libraryPage.clearFilters",
            )}
          </Button>
        </div>
      ) : null}
      {drafting === vaultId ? (
        <NewStudyDocument
          key={vaultId}
          vaultId={vaultId}
          recovery={recovery}
          onClose={() => setDrafting(undefined)}
          onSave={(book) => {
            setDrafting((current) => (current === vaultId ? undefined : current));
            if (currentVaultId() === vaultId) openBook(book);
          }}
        />
      ) : null}
      {choosing?.vaultId === vaultId ? (
        <ImportStudyFiles
          key={vaultId}
          vaultId={vaultId}
          files={choosing.files}
          onClose={() => setChoosing(null)}
          onImport={(notebook) => {
            setChoosing(null);
            void importBooks(choosing.files, notebook);
          }}
        />
      ) : null}
      {addingMedia === vaultId ? (
        <AddTranscriptDialog
          key={vaultId}
          onClose={() => setAddingMedia(undefined)}
          fields={(saving) => (
            <StudyNotebookField
              vaultId={vaultId}
              value={mediaNotebook}
              onChange={setMediaNotebook}
              disabled={saving}
            />
          )}
          onSave={async ({ title, text, link }) => {
            const book = await addStudyBook({
              title,
              format: "text",
              sections: [{ title, ...studyDocumentContent(text, false) }],
              vaultId,
              url: link,
              notebookId: chosenNotebook(mediaNotebook),
            });
            setAddingMedia((current) => (current === vaultId ? undefined : current));
            if (currentVaultId() === vaultId) openBook(book);
          }}
        />
      ) : null}
      {editing ? (
        <RenameDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          title={t("study.library.rename")}
          label={t("study.library.title")}
          value={editing.title}
          onSave={(name) =>
            (editing.kind === "book"
              ? renameStudyBook(editing.book, name)
              : renameSource(editing.id, name)
            ).catch((error: Error) => {
              toast.error(error.message);
            })
          }
        />
      ) : null}
      <StudyDocumentRemovalDialog
        removal={removing}
        notebook={removingFrom}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}

/** The document the reader left off in most recently, for the "continue reading" line. */
function studyResume(entries: readonly Entry[], fallback: string) {
  const entry = entries.find((item) => {
    if (item.kind !== "book" || !item.book.lastReadAt) return false;
    const progress = studyReadingProgress(item.book);
    return progress > 0 && progress < 1;
  });
  if (entry?.kind !== "book") return undefined;
  const { book } = entry;
  const progress = Math.min(0.99, studyReadingProgress(book));
  return {
    book,
    title: book.title,
    where: book.sections[book.section]?.title || fallback,
    percent: new Intl.NumberFormat(undefined, { style: "percent" }).format(progress),
    current: book.section + 1,
    total: book.sections.length,
  };
}

/**
 * One document in the list: its title and type, the notebook it lives in and
 * how far it has been read. A source not opened in Study yet shows as not
 * started; a book whose source was deleted from its notebook says so, and
 * stays readable.
 */
function LibraryRow({
  entry,
  notebook,
  highlights: count,
  opening,
  open,
  rename,
  remove,
}: {
  entry: Entry;
  notebook: string | undefined;
  highlights: number;
  opening: string | undefined;
  open: (entry: Entry) => void;
  rename: (entry: Entry) => void;
  remove: (removal: StudyDocumentRemoval) => void;
}) {
  const { t, i18n } = useTranslation("home");
  const { t: tSources } = useTranslation("sources");
  const percent = new Intl.NumberFormat(i18n.language, { style: "percent" });
  const book = entry.kind === "book" ? entry.book : undefined;
  const position = book ? studyReadingProgress(book) : 0;
  const shown = position < 1 ? Math.min(0.99, position) : 1;
  const type = libraryEntryType(entry);
  const kind = tSources(`kinds.${type}`);
  const document = { notebookId: entry.notebookId, sourceId: book ? book.sourceId : entry.id };
  const busy = !book && opening === entry.id;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_11rem_9rem_2rem]">
      <button
        type="button"
        aria-label={t("study.today.openBook", { title: entry.title })}
        disabled={!book && opening !== undefined}
        aria-busy={busy}
        className="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg text-start outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-progress disabled:opacity-60"
        onClick={() => open(entry)}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon
            icon={
              type === "url"
                ? Link01Icon
                : type === "pdf" || type === "epub"
                  ? Book02Icon
                  : File02Icon
            }
            size={18}
          />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold" dir="auto">
            {entry.title}
          </span>
          <span className="block truncate text-xs text-muted-foreground" dir="auto">
            {entry.kind === "book" && entry.sourceRemoved
              ? `${kind} · ${t("study.library.sourceRemoved")}`
              : kind}
          </span>
        </span>
      </button>
      <Menu>
        <Menu.Trigger
          render={
            <Button
              variant="ghost"
              shape="pill"
              size="icon-sm"
              className="shrink-0 sm:order-last"
            />
          }
          aria-label={t("study.library.options", { title: entry.title })}
        >
          <Icon icon={MoreHorizontalIcon} />
        </Menu.Trigger>
        <Menu.Content align="end">
          <Menu.Item onClick={() => rename(entry)}>
            <Icon icon={PencilEdit01Icon} />
            {t("study.library.rename")}
          </Menu.Item>
          {book ? (
            <Menu.Item onClick={() => remove({ kind: "progress", book })}>
              <Icon icon={BookmarkRemove01Icon} />
              {t("study.library.removeProgress")}
            </Menu.Item>
          ) : null}
          <Menu.Item variant="destructive" onClick={() => remove({ kind: "delete", document })}>
            <Icon icon={Delete02Icon} />
            {t("study.library.delete")}
          </Menu.Item>
        </Menu.Content>
      </Menu>
      <div className="col-span-2 min-w-0 text-sm sm:col-span-1">
        {notebook === undefined ? (
          <span className="text-muted-foreground">{t("study.library.unknownNotebook")}</span>
        ) : (
          <Link
            to={routes.notebook(entry.notebookId)}
            aria-label={t("study.libraryPage.inNotebook", { notebook })}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon icon={Book02Icon} size={14} className="shrink-0" />
            <span className="truncate" dir="auto">
              {notebook}
            </span>
          </Link>
        )}
      </div>
      <div className="col-span-2 min-w-0 sm:col-span-1">
        {position > 0 ? (
          <StudyProgressBar
            className="mb-1 h-1"
            value={shown}
            label={t("study.library.progress")}
          />
        ) : null}
        <p className="text-xs text-muted-foreground">
          {position > 0
            ? t("study.library.shelfMeta", {
                percent: percent.format(shown),
                highlights: t("study.today.counts.highlights", { count }),
              })
            : count
              ? t("study.library.notStartedWithHighlights", {
                  highlights: t("study.today.counts.highlights", { count }),
                })
              : t("study.library.notStarted")}
        </p>
      </div>
    </li>
  );
}

/** A filter button with a radio menu: "All …" or one value, each with its document count. */
function FilterMenu({
  name,
  all,
  value,
  onChange,
  options,
  total,
}: {
  name: string;
  all: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; count: number }[];
  total: number;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <Menu>
      <Menu.Trigger
        render={
          <Button
            variant="outline"
            shape="pill"
            className={cn(current && "border-foreground/40")}
          />
        }
        aria-label={`${name}: ${current?.label ?? all}`}
      >
        <span className="text-muted-foreground">{name}</span>
        <span className="max-w-40 truncate" dir="auto">
          {current?.label ?? all}
        </span>
        <Icon icon={ArrowDown01Icon} size={14} />
      </Menu.Trigger>
      <Menu.Content align="start">
        <Menu.RadioGroup value={value} onValueChange={(next) => onChange(String(next))}>
          <Menu.RadioItem value="all">
            {all}
            <span className="ms-auto ps-3 text-xs text-muted-foreground">{total}</span>
          </Menu.RadioItem>
          {options.map((option) => (
            <Menu.RadioItem key={option.value} value={option.value}>
              <span className="truncate" dir="auto">
                {option.label}
              </span>
              <span className="ms-auto ps-3 text-xs text-muted-foreground">{option.count}</span>
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </Menu.Content>
    </Menu>
  );
}

/** "Which notebook?" for files chosen or dropped in the Library, before they are added. */
function ImportStudyFiles({
  vaultId,
  files,
  onClose,
  onImport,
}: {
  vaultId: string;
  files: File[];
  onClose: () => void;
  onImport: (notebookId: string | undefined) => void;
}) {
  const { t } = useTranslation("home");
  const { t: tCommon } = useTranslation();
  const [notebook, setNotebook] = useState<StudyNotebookChoice>("");
  const form = useId();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content closeLabel={tCommon("actions.close")}>
        <Dialog.Header
          title={t("study.library.importTitle", { count: files.length })}
          description={t("study.library.importDescription")}
        />
        <Dialog.Body>
          <form
            id={form}
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              onImport(chosenNotebook(notebook));
            }}
          >
            <ul className="grid gap-1 text-sm" aria-label={t("study.library.importFiles")}>
              {files.map((file, index) => (
                <li key={`${index}:${file.name}`} className="flex min-w-0 items-center gap-2">
                  <Icon
                    icon={FileImportIcon}
                    size={16}
                    className="shrink-0 text-muted-foreground"
                  />
                  <span className="truncate" dir="auto">
                    {file.name}
                  </span>
                </li>
              ))}
            </ul>
            <StudyNotebookField
              vaultId={vaultId}
              value={notebook}
              onChange={setNotebook}
              several={files.length > 1}
            />
          </form>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close render={<Button variant="secondary" />}>
            {tCommon("actions.cancel")}
          </Dialog.Close>
          <Button type="submit" form={form}>
            {t("study.library.importConfirm", { count: files.length })}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}

function NotebookLibraryScope({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation("home");
  const notebook = useNotebook(notebookId);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b pb-3 text-sm">
      {notebook ? (
        <Link
          className={buttonVariants({ variant: "outline", shape: "pill" })}
          to={`${routes.notebook(notebookId)}?tab=sources`}
        >
          <Icon icon={Book02Icon} />
          <span dir="auto">{notebook.title}</span>
        </Link>
      ) : null}
      <Link
        to={studyHref("library")}
        className="rounded-md px-2 py-1 text-muted-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("study.library.allDocuments")}
      </Link>
    </div>
  );
}

function NewStudyDocument({
  vaultId,
  recovery,
  onClose,
  onSave,
}: {
  vaultId: string;
  recovery: ReturnType<typeof useStudyDocumentRecovery>;
  onClose: () => void;
  onSave: (book: StudyBook) => void;
}) {
  const { t } = useTranslation("home");
  const { t: tCommon } = useTranslation();
  const [editor, setEditor] = useState(
    (): { draft: Extract<StudyDocumentSnapshot, { kind: "new" }>; row?: StudyDocumentRecovery } => {
      const existing = recovery.latest;
      return existing?.snapshot?.kind === "new"
        ? { draft: existing.snapshot, row: existing }
        : { draft: { kind: "new", title: "", text: "", markdown: false } };
    },
  );
  const { draft, row } = editor;
  const [saving, setSaving] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [notebook, setNotebook] = useState<StudyNotebookChoice>("");
  const form = useId();
  function update(change: Partial<Pick<typeof draft, "title" | "text" | "markdown">>) {
    const next = { ...draft, ...change };
    setEditor({ draft: next, row: recovery.stage(next) });
  }
  return (
    <>
      <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
        <Dialog.Content closeLabel={tCommon("actions.close")}>
          <Dialog.Header title={t("study.library.newText")} />
          <Dialog.Body>
            <form
              id={form}
              className="grid gap-3"
              onSubmit={async (event) => {
                event.preventDefault();
                if (saving || !draft.title.trim() || !draft.text.trim()) return;
                setSaving(true);
                try {
                  const created = await addStudyBook({
                    title: draft.title,
                    format: "text",
                    sections: [
                      { title: draft.title, ...studyDocumentContent(draft.text, draft.markdown) },
                    ],
                    vaultId,
                    notebookId: chosenNotebook(notebook),
                  });
                  if (row) await recovery.clear(row).catch(console.error);
                  onSave(created);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : String(error));
                  setSaving(false);
                }
              }}
            >
              <label className="grid gap-1.5 text-sm font-medium">
                {t("study.library.title")}
                <Input
                  required
                  disabled={saving}
                  value={draft.title}
                  onChange={(event) => update({ title: event.target.value })}
                />
              </label>
              <StudyDocumentEditor
                value={draft}
                onChange={update}
                label={t("study.library.text")}
                disabled={saving}
              />
              <StudyNotebookField
                vaultId={vaultId}
                value={notebook}
                onChange={setNotebook}
                disabled={saving}
              />
            </form>
          </Dialog.Body>
          <Dialog.Footer>
            {row ? (
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => setDiscard(true)}
              >
                {t("study.documentEditor.discardDraft")}
              </Button>
            ) : null}
            <Dialog.Close render={<Button variant="secondary" disabled={saving} />}>
              {tCommon(row ? "actions.close" : "actions.cancel")}
            </Dialog.Close>
            <Button
              type="submit"
              form={form}
              disabled={saving || !draft.title.trim() || !draft.text.trim()}
            >
              {t("study.library.save")}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
      <ConfirmDialog
        open={discard}
        onOpenChange={setDiscard}
        title={t("study.documentEditor.discardTitle")}
        body={t("study.documentEditor.discardDescription")}
        confirmLabel={t("study.documentEditor.discardDraft")}
        onConfirm={async () => {
          if (row) await recovery.clear(row);
          onClose();
        }}
      />
    </>
  );
}
