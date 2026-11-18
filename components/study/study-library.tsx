import {
  Add01Icon,
  Book02Icon,
  Delete02Icon,
  FileImportIcon,
  MoreHorizontalIcon,
  Pdf01Icon,
  PencilEdit01Icon,
  TextIcon,
} from "@hugeicons/core-free-icons";
import { useId, useRef, useState } from "react";
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
import { Textarea } from "@/components/panelui/textarea";
import { useNotebook } from "@/lib/db/notebooks";
import { addStudyBook, deleteStudyBook, renameStudyBook } from "@/lib/db/study";
import { currentVaultId } from "@/lib/db/vaults";
import { routes } from "@/lib/routes";
import { studyHref } from "@/lib/study/links";
import { readStudyFile } from "@/lib/study/read-file";
import type { StudyBook } from "@/lib/study/records";

const formatIcons = { pdf: Pdf01Icon, epub: Book02Icon, text: TextIcon };

export function StudyLibrary({
  books,
  notebookId,
  vaultId,
  openBook,
}: {
  books: StudyBook[];
  notebookId: string | null;
  vaultId: string;
  openBook: (book: StudyBook) => void;
}) {
  const { t } = useTranslation("home");
  const { t: tNotes } = useTranslation("notes");
  const input = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<StudyBook | null>(null);
  const [editing, setEditing] = useState<StudyBook | null>(null);
  const [drafting, setDrafting] = useState(false);
  const matches = books.filter((book) =>
    book.title.toLowerCase().includes(search.trim().toLowerCase()),
  );

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

  return (
    <section className="space-y-5" aria-labelledby="study-library">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="study-library" className="text-xl font-semibold tracking-tight">
          {t("study.tabs.library")}
        </h2>
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
            <Button shape="pill" variant="outline" onClick={() => setDrafting(true)}>
              <Icon icon={Add01Icon} />
              {t("study.library.newText")}
            </Button>
            <Button shape="pill" onClick={() => input.current?.click()} disabled={loading}>
              <Icon icon={FileImportIcon} />
              {t(loading ? "study.library.importing" : "study.library.import")}
            </Button>
            <input
              ref={input}
              type="file"
              accept=".pdf,.epub,.txt,.md"
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
      {books.length ? (
        <Input
          type="search"
          className="max-w-sm"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("study.library.search")}
          aria-label={t("study.library.search")}
        />
      ) : null}
      {matches.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {matches.map((book) => (
            <Card as="li" size="sm" key={book.id} className="min-w-0 shadow-none">
              <Card.Header>
                <Card.Title as="h3">
                  <button
                    type="button"
                    className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-xl text-start outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => openBook(book)}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                      <Icon icon={formatIcons[book.format]} size={18} />
                    </span>
                    <span className="truncate" dir="auto">
                      {book.title}
                    </span>
                  </button>
                </Card.Title>
                <Card.Action>
                  <Menu>
                    <Menu.Trigger
                      render={<Button variant="ghost" shape="pill" size="icon-sm" />}
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
                </Card.Action>
              </Card.Header>
              <Card.Content className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">
                  {t("study.library.position", {
                    format: book.format.toUpperCase(),
                    current: book.section + 1,
                    total: book.sections.length,
                  })}
                </p>
                {book.sections.length > 1 ? (
                  <progress
                    className="h-1 w-full appearance-none overflow-hidden rounded-full bg-muted [&::-moz-progress-bar]:bg-primary/70 [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary/70"
                    max={book.sections.length}
                    value={book.section + 1}
                    aria-label={t("study.library.progress")}
                  />
                ) : null}
              </Card.Content>
            </Card>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
            <Icon icon={Book02Icon} size={24} />
          </span>
          <p className="font-semibold">
            {t(books.length ? "study.library.noMatches" : "study.library.empty")}
          </p>
          {books.length ? null : (
            <p className="max-w-xs text-sm text-muted-foreground">
              {t(notebookId ? "study.library.emptyNotebook" : "study.library.emptyDescription")}
            </p>
          )}
        </div>
      )}
      {drafting ? (
        <NewStudyDocument
          vaultId={vaultId}
          onClose={() => setDrafting(false)}
          onSave={(book) => {
            setDrafting(false);
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
  onClose,
  onSave,
}: {
  vaultId: string;
  onClose: () => void;
  onSave: (book: StudyBook) => void;
}) {
  const { t } = useTranslation("home");
  const { t: tCommon } = useTranslation();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const form = useId();
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <Dialog.Content closeLabel={tCommon("actions.close")}>
        <Dialog.Header title={t("study.library.newText")} />
        <Dialog.Body>
          <form
            id={form}
            className="grid gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
              if (saving || !title.trim() || !text.trim()) return;
              setSaving(true);
              try {
                onSave(
                  await addStudyBook({
                    title,
                    format: "text",
                    sections: [{ title, text }],
                    vaultId,
                  }),
                );
              } catch (error) {
                toast.error(error instanceof Error ? error.message : String(error));
                setSaving(false);
              }
            }}
          >
            <label className="grid gap-1.5 text-sm font-medium">
              {t("study.library.title")}
              <Input required value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t("study.library.text")}
              <Textarea
                dir="auto"
                required
                minRows={5}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
          </form>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close render={<Button variant="secondary" disabled={saving} />}>
            {tCommon("actions.cancel")}
          </Dialog.Close>
          <Button type="submit" form={form} disabled={saving || !title.trim() || !text.trim()}>
            {t("study.library.save")}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
