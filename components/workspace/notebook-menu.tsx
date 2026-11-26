import {
  ArrowDown01Icon,
  Book02Icon,
  Delete02Icon,
  GridViewIcon,
  NoteAddIcon,
  PencilEdit01Icon,
} from "@hugeicons/core-free-icons";
import { useNavigate } from "react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { RenameDialog } from "@/components/common/rename-dialog";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Menu } from "@/components/panelui/menu";
import { NotebookDialog } from "@/components/home/notebook-dialog";
import { useFolders } from "@/lib/db/folders";
import { createNotebook, deleteNotebook, renameNotebook } from "@/lib/db/notebooks";
import { notebookIcon } from "@/lib/notebooks/icons";
import { useWorkspace } from "./workspace-context";
import { routes } from "@/lib/routes";
import { studyHref } from "@/lib/study/links";

/** The notebook's name, opening a menu to switch, rename or delete it. */
export function NotebookMenu() {
  const { t } = useTranslation("workspace");
  const { t: tHome } = useTranslation("home");
  const { notebook } = useWorkspace();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const folders = useFolders() ?? [];

  return (
    <>
      <Menu>
        <Menu.Trigger
          aria-label={t("notebookMenu")}
          title={notebook.title}
          render={
            <Button
              variant="ghost"
              className="h-auto max-w-full min-w-0 shrink justify-start gap-1 rounded-lg px-2 py-1.5 text-start active:not-disabled:scale-100 max-sm:min-h-11"
            />
          }
        >
          <Icon
            icon={notebookIcon(notebook.icon)}
            size={16}
            className="shrink-0 text-muted-foreground"
          />
          <span className="truncate text-[0.9375rem] font-semibold">{notebook.title}</span>
          <Icon icon={ArrowDown01Icon} size={16} className="shrink-0 text-muted-foreground" />
        </Menu.Trigger>
        <Menu.Content align="center">
          <Menu.Item onClick={() => navigate(routes.home)}>
            <Icon icon={GridViewIcon} />
            {t("allNotebooks")}
          </Menu.Item>
          <Menu.Item onClick={() => setCreating(true)}>
            <Icon icon={NoteAddIcon} />
            {t("newNotebook")}
          </Menu.Item>
          <Menu.Item onClick={() => navigate(studyHref("library", { notebook: notebook.id }))}>
            <Icon icon={Book02Icon} />
            {t("studyDocuments")}
          </Menu.Item>
          <Menu.Separator />
          <Menu.Item onClick={() => setRenaming(true)}>
            <Icon icon={PencilEdit01Icon} />
            {t("renameNotebook")}
          </Menu.Item>
          <Menu.Item variant="destructive" onClick={() => setDeleting(true)}>
            <Icon icon={Delete02Icon} />
            {t("deleteNotebook")}
          </Menu.Item>
        </Menu.Content>
      </Menu>
      <RenameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title={t("rename.title")}
        label={t("rename.label")}
        value={notebook.title}
        onSave={(title) => renameNotebook(notebook.id, title)}
      />
      <NotebookDialog
        open={creating}
        onOpenChange={setCreating}
        mode="create"
        folders={folders}
        initial={{ title: "", folderId: notebook.folderId ?? null }}
        onSubmit={async ({ title, ...look }) => {
          const id = await createNotebook(title || tHome("untitled"), look);
          navigate(routes.notebook(id));
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("delete.title", { title: notebook.title })}
        body={t("delete.body")}
        confirmLabel={t("delete.confirm")}
        onConfirm={async () => {
          navigate(routes.home);
          await deleteNotebook(notebook.id);
        }}
      />
    </>
  );
}
