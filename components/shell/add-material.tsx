import { useState } from "react";
import { AddSourceDialog } from "@/components/sources/add-source-dialog";
import type { Notebook } from "@/lib/db/types";
import { addTarget } from "./nav-model";

/**
 * The sidebar's Add: the one box for a link, files or text, opened on the
 * notebook `addTarget` picks (its notebook row changes it). In a vault with
 * no notebook yet, the box asks for the new notebook's name instead and
 * makes it when something is added.
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
  const target = addTarget(notebooks, vaultId, notebookId);
  const key = target ?? `vault:${vaultId}`;
  // The box keeps its notebook while open: one it makes itself must not start it afresh.
  const [shown, setShown] = useState({ key, target });
  if (!open && shown.key !== key) setShown({ key, target });
  return (
    <AddSourceDialog
      // A new key per notebook (or vault, without one), so the box starts there.
      key={shown.key}
      notebookId={shown.target}
      vaultId={vaultId}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}
