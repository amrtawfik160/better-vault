import {
  Add01Icon,
  Book02Icon,
  Delete02Icon,
  FileImportIcon,
  MoreHorizontalIcon,
  PencilEdit01Icon,
} from "@hugeicons/core-free-icons";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { RenameDialog } from "@/components/common/rename-dialog";
import { Icon } from "@/components/icon";
import { Button, buttonVariants } from "@/components/panelui/button";
import { Card } from "@/components/panelui/card";
import { Dialog } from "@/components/panelui/dialog";
import { Input } from "@/components/panelui/input";
import { Menu } from "@/components/panelui/menu";
import { sourceKindIcons } from "@/components/sources/source-kind";
import { useNotebook } from "@/lib/db/notebooks";
import { useSources } from "@/lib/db/sources";
import { addStudyBook, deleteStudyBook, renameStudyBook, studyBookForSource } from "@/lib/db/study";
import { currentVaultId } from "@/lib/db/vaults";
import { routes } from "@/lib/routes";
import { studyHref } from "@/lib/study/links";
import { readStudyFile } from "@/lib/study/read-file";
import { studyReadingProgress } from "@/lib/study/reading-progress";
import { studyDocumentContent } from "@/lib/study/markdown-document";
import { studyDocumentDraftId } from "@/lib/study/document-drafts";
import type { StudyBook, StudyDocumentRecovery, StudyDocumentSnapshot, StudyRecordOf } from "@/lib/study/records";
import { cn } from "@/lib/utils";
import { StudyBookCover, StudyProgressBar } from "./study-book-cover";
import { StudyDocumentEditor } from "./study-document-editor";
import { useStudyDocumentRecovery } from "./study-document-recovery";

const studyFileTypes = /\.(pdf|epub|txt|text|md|markdown|mdx)$/i;
const studyMimeTypes = new Set(["application/pdf", "application/epub+zip", "text/plain", "text/markdown"]);
const isStudyFile = (file: File) => studyFileTypes.test(file.name) || studyMimeTypes.has(file.type);

export function StudyLibrary({
  books,
  highlights,
  notebookTitles,
  notebookId,
  vaultId,
  openBook,
}: {
  books: StudyBook[];
  highlights: StudyRecordOf<"highlight">[];
  notebookTitles: ReadonlyMap<string, string>;
  notebookId: string | null;
  vaultId: string;
  openBook: (book: StudyBook) => void;
}) {
  const { t, i18n } = useTranslation("home");
  const { t: tNotes } = useTranslation("notes");
  const { t: tCommon } = useTranslation();
  const { t: tSources } = useTranslation("sources");
  const input = useRef<HTMLInputElement>(null);
  const openingSource = useRef<AbortController>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<string>();
  const [deleting, setDeleting] = useState<StudyBook | null>(null);
  const [editing, setEditing] = useState<StudyBook | null>(null);
  const [drafting, setDrafting] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const recovery = useStudyDocumentRecovery({ id: studyDocumentDraftId({ vaultId }), vaultId });
  const sources = useSources(notebookId ?? "");
  const studied = new Set(books.map(({ sourceId }) => sourceId));
  const unread = (sources ?? []).filter(
    (source) => source.notebookId === notebookId && !studied.has(source.id),
  );
  const query = search.trim().toLowerCase();
  const matches = books.filter(({ title }) => title.toLowerCase().includes(query));
  const unreadMatches = unread.filter(({ title }) => title.toLowerCase().includes(query));

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

  async function importBooks(files: File[]) {
    setLoading(true);
    let last: StudyBook | undefined;
    try {
      for (const file of files) {
        try {
          last = await addStudyBook({ ...(await readStudyFile(file)), vaultId });
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
      if (!accepted.includes(file)) toast.error(t("study.library.unsupported", { name: file.name }));
    if (accepted.length) void importBooks(accepted);
  }

  const canImport = !notebookId;
  const percent = new Intl.NumberFormat(i18n.language, { style: "percent" });
  const highlightCounts = new Map<string, number>();
  for (const { bookId } of highlights) highlightCounts.set(bookId, (highlightCounts.get(bookId) ?? 0) + 1);

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
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t("study.tabs.library")}</p>
          <h2 id="study-library" className="text-2xl font-semibold tracking-tight">
            {t("study.library.shelfTitle")}
          </h2>
        </div>
        {notebookId ? null : (
          <div className="flex flex-wrap gap-2">
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
            <Button
              shape="pill"
              variant="outline"
              disabled={!recovery.ready}
              onClick={() => setDrafting(vaultId)}
            >
              <Icon icon={Add01Icon} />
              {t(
                recovery.latest?.snapshot?.kind === "new"
                  ? "study.documentEditor.resumeNew"
                  : "study.library.newText",
              )}
            </Button>
            <Button shape="pill" onClick={() => input.current?.click()} disabled={loading}>
              <Icon icon={FileImportIcon} />
              {t(loading ? "study.library.importing" : "study.library.addBook")}
            </Button>
            <input
              ref={input}
              type="file"
              accept=".pdf,.epub,.txt,.text,.md,.markdown,.mdx,application/pdf,application/epub+zip,text/plain,text/markdown"
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                if (files.length) void importBooks(files);
              }}
            />
          </div>
        )}
      </div>
      {notebookId ? <NotebookLibraryScope notebookId={notebookId} /> : null}
      {books.length || unread.length ? (
        <Input
          type="search"
          className="max-w-sm"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("study.library.search")}
          aria-label={t("study.library.search")}
        />
      ) : null}
      {matches.length || (canImport && !query) ? (
        <ul className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
          {matches.map((book) => {
            const byline = notebookTitles.get(book.notebookId);
            const shownByline = byline && byline.trim() !== book.title.trim() ? byline : undefined;
            const position = studyReadingProgress(book);
            const shown = position < 1 ? Math.min(0.99, position) : 1;
            const count = highlightCounts.get(book.id) ?? 0;
            return (
              <li key={book.id} className="flex min-w-0 flex-col gap-2">
                <button
                  type="button"
                  aria-label={t("study.today.openBook", { title: book.title })}
                  className="cursor-pointer rounded-e-xl outline-none transition-transform hover:-translate-y-1 focus-visible:ring-[3px] focus-visible:ring-ring/40 motion-reduce:transition-none"
                  onClick={() => openBook(book)}
                >
                  <StudyBookCover book={book} byline={shownByline} className="w-full" />
                </button>
                <div className="flex min-w-0 items-start gap-1">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold" dir="auto">
                      {book.title}
                    </h3>
                    <p className="truncate text-xs text-muted-foreground" dir="auto">
                      {shownByline ??
                        (book.sections.some((section) => section.markdown !== undefined)
                          ? "Markdown"
                          : book.format.toUpperCase())}
                    </p>
                  </div>
                  <Menu>
                    <Menu.Trigger
                      render={<Button variant="ghost" shape="pill" size="icon-sm" className="-me-1.5 shrink-0" />}
                      aria-label={t("study.library.options", { title: book.title })}
                    >
                      <Icon icon={MoreHorizontalIcon} />
                    </Menu.Trigger>
                    <Menu.Content align="end">
                      <Menu.Item onClick={() => setEditing(book)}>
                        <Icon icon={PencilEdit01Icon} />
                        {t("study.library.rename")}
                      </Menu.Item>
                      <Menu.Item variant="destructive" onClick={() => setDeleting(book)}>
                        <Icon icon={Delete02Icon} />
                        {t("study.library.delete")}
                      </Menu.Item>
                    </Menu.Content>
                  </Menu>
                </div>
                <StudyProgressBar className="h-1" value={shown} label={t("study.library.progress")} />
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
              </li>
            );
          })}
          {canImport && !query ? (
            <li className="min-w-0">
              <button
                type="button"
                disabled={loading}
                onClick={() => input.current?.click()}
                className={cn(
                  "flex aspect-[2/3] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-center text-muted-foreground outline-none transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-progress",
                  dragging && "border-primary bg-muted/60 text-foreground",
                )}
              >
                <Icon icon={FileImportIcon} size={22} />
                <span className="text-sm font-medium">
                  {t(loading ? "study.library.importing" : dragging ? "study.library.dropHere" : "study.library.addBook")}
                </span>
                <span className="text-xs">{t("study.library.formats")}</span>
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {unreadMatches.length ? (
        <section className="space-y-3" aria-labelledby="study-notebook-sources">
          <h3 id="study-notebook-sources" className="text-sm font-medium text-muted-foreground">
            {t("study.materials.sources")}
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {unreadMatches.map((source) => (
              <Card as="li" size="sm" key={source.id} className="min-w-0 shadow-none">
                <Card.Header>
                  <Card.Title as="h4">
                    <button
                      type="button"
                      disabled={opening !== undefined}
                      aria-busy={opening === source.id}
                      className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-xl text-start outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60"
                      onClick={() => void readSource(source.id)}
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                        <Icon icon={sourceKindIcons[source.kind]} size={18} />
                      </span>
                      <span className="truncate" dir="auto">
                        {source.title}
                      </span>
                    </button>
                  </Card.Title>
                </Card.Header>
                <Card.Content>
                  <p className="text-xs text-muted-foreground">
                    {tSources(`kinds.${source.kind}`)}
                  </p>
                </Card.Content>
              </Card>
            ))}
          </ul>
        </section>
      ) : null}
      {notebookId && sources === undefined && !matches.length ? (
        <p role="status" className="text-sm text-muted-foreground">
          {tCommon("status.loading")}
        </p>
      ) : !matches.length && !unreadMatches.length && canImport && !query ? (
        <p className="text-sm text-muted-foreground">{t("study.library.emptyDescription")}</p>
      ) : !matches.length && !unreadMatches.length ? (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
            <Icon icon={Book02Icon} size={24} />
          </span>
          <p className="font-semibold">
            {t(books.length || unread.length ? "study.library.noMatches" : "study.library.empty")}
          </p>
          {books.length || unread.length ? null : (
            <p className="max-w-xs text-sm text-muted-foreground">
              {t(notebookId ? "study.library.emptyNotebook" : "study.library.emptyDescription")}
            </p>
          )}
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
      {editing ? (
        <RenameDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          title={t("study.library.rename")}
          label={t("study.library.title")}
          value={editing.title}
          onSave={(name) =>
            renameStudyBook(editing, name).catch((error: Error) => {
              toast.error(error.message);
            })
          }
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("study.library.deleteTitle")}
        body={t(
          deleting?.attachedToNotebook ? "study.library.removeBody" : "study.library.deleteBody",
        )}
        confirmLabel={t("study.library.delete")}
        onConfirm={async () => {
          if (deleting) await deleteStudyBook(deleting);
          setDeleting(null);
        }}
      />
    </section>
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
