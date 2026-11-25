import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NotebookDialog } from "@/components/home/notebook-dialog";
import { AddSourceDialog } from "@/components/sources/add-source-dialog";
import type { Notebook } from "@/lib/db/types";
import { DEFAULT_VAULT } from "@/lib/db/vaults";
import { createNotebook } from "@/lib/db/notebooks";
import { addTarget } from "./nav-model";

/**
 * The sidebar's Add: the one box for a link, files or text, opened on the
 * notebook `addTarget` picks (its notebook row changes it). A vault with no
 * notebook yet asks for one first.
 */
export function AddMaterial({
  open,
  onOpenChange,
  notebooks,
  vaultId,
  notebookId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebooks: readonly Notebook[];
  vaultId: string;
  /** The notebook the page shows, if any. */
  notebookId?: string;
}) {
  const { t } = useTranslation("home");
  const [created, setCreated] = useState<string | null>(null);
  // The notebook dialog closes itself after saving; Add then goes on to the box instead.
  const justCreated = useRef(false);
  const target = created ?? addTarget(notebooks, vaultId, notebookId);

  if (!target)
    return (
      <NotebookDialog
        open={open}
        onOpenChange={(next) => {
          if (!next && justCreated.current) justCreated.current = false;
          else onOpenChange(next);
        }}
        mode="create"
        folders={[]}
        initial={{ title: "", folderId: null }}
        onSubmit={async ({ title, ...look }) => {
          const id = await createNotebook(title || t("untitled"), {
            ...look,
            ...(vaultId !== DEFAULT_VAULT ? { vaultId } : {}),
          });
          justCreated.current = true;
          setCreated(id);
        }}
      />
    );

  return (
    <AddSourceDialog
      // A new key per notebook, so the box starts on that notebook.
      key={target}
      notebookId={target}
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          justCreated.current = false;
          setCreated(null);
        }
        onOpenChange(next);
      }}
    />
  );
}
