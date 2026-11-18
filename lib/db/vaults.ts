import { generateId } from "ai";
import { useSyncExternalStore } from "react";
import { clearReviewCheckpoint } from "@/lib/study/review-session";
import { clearDocumentRecoveries, clearDocumentRecovery, studyDocumentDraftId } from "@/lib/study/document-drafts";
import { DEFAULT_VAULT, studyVaultIndex } from "@/lib/study/vault";
import { useStoreQuery } from "./live";
import { store } from "./store";
import type { Folder, Notebook, Vault } from "./types";

export { DEFAULT_VAULT } from "@/lib/study/vault";

const defaultVault = (): Vault => ({
  id: DEFAULT_VAULT,
  name: "",
  icon: undefined,
  color: undefined,
  order: 0,
  createdAt: 0,
  updatedAt: 0,
});

/** The vault a notebook or folder is in. */
export const vaultOf = (item: Pick<Notebook | Folder, "vaultId">) => item.vaultId ?? DEFAULT_VAULT;

/** Every vault in switcher order, the default one included even before it is saved. */
export async function listVaults(): Promise<Vault[]> {
  const saved = await store().listVaults();
  const all = saved.some((vault) => vault.id === DEFAULT_VAULT)
    ? saved
    : [defaultVault(), ...saved];
  return all.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

export function useVaults(): Vault[] | undefined {
  return useStoreQuery(listVaults, [], ["vaults"]);
}

export type VaultLook = Partial<Pick<Vault, "name" | "icon" | "color">>;

export async function createVault(look: VaultLook): Promise<string> {
  const vaults = await listVaults();
  const now = Date.now();
  const id = generateId();
  await store().putVault({
    id,
    name: look.name?.trim() ?? "",
    ...(look.icon ? { icon: look.icon } : {}),
    ...(look.color ? { color: look.color } : {}),
    order: Math.max(0, ...vaults.map((vault) => vault.order)) + 1,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function updateVault(id: string, look: VaultLook) {
  const current = (await listVaults()).find((vault) => vault.id === id);
  if (!current) return;
  const next: Vault = { ...current, ...look, updatedAt: Date.now() };
  if (look.name !== undefined) next.name = look.name.trim();
  await store().putVault(next);
}

/**
 * Deletes a vault with every notebook, folder, note, skill and study record in it, and
 * everything in those. The default vault stays.
 */
export async function deleteVault(id: string) {
  if (id === DEFAULT_VAULT) return;
  const backend = store();
  const [notebooks, notes, rows, vaults] = await Promise.all([
    backend.listNotebooks(),
    backend.listNotes(),
    backend.listStudy(),
    listVaults(),
  ]);
  const scope = studyVaultIndex({ rows, notebooks, notes, vaults, defaultVaultId: DEFAULT_VAULT });
  const deletingNotebooks = new Set(
    notebooks.filter((item) => vaultOf(item) === id).map(({ id }) => id),
  );
  for (const row of rows) {
    if (scope.owner(row) === id && !deletingNotebooks.has(row.notebookId ?? ""))
      await backend.deleteStudy(row.id);
  }
  for (const notebookId of deletingNotebooks) await backend.deleteNotebook(notebookId);
  const folders = (await store().listFolders()).filter((item) => vaultOf(item) === id);
  for (const folder of folders) await store().deleteFolder(folder.id);
  for (const note of notes) {
    if (scope.noteOwner(note.id) === id) await backend.deleteNote(note.id);
  }
  for (const skill of (await store().listSkills()).filter((item) => item.vaultId === id))
    await store().deleteSkill(skill.id);
  await store().deleteVault(id);
  clearDocumentRecovery(studyDocumentDraftId({ vaultId: id }));
  for (const row of rows) {
    if (row.kind === "book" && scope.owner(row) === id)
      clearDocumentRecoveries(`document-draft:book:${row.id}:`);
  }
  clearReviewCheckpoint(id);
  if (currentVaultId() === id) setCurrentVault(DEFAULT_VAULT);
}

/* The vault shown on the notebooks page, remembered on this device. */

const CURRENT_KEY = "better-vault:vault";
const CHANGE = "better-vault:vault-change";

/** The vault chosen in the sidebar, as saved. */
export function currentVaultId(): string {
  try {
    return window.localStorage.getItem(CURRENT_KEY) ?? DEFAULT_VAULT;
  } catch {
    return DEFAULT_VAULT;
  }
}

export function setCurrentVault(id: string) {
  try {
    window.localStorage.setItem(CURRENT_KEY, id);
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
  window.dispatchEvent(new Event(CHANGE));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The current vault's id; the default one when the saved vault is gone. */
export function useCurrentVault(vaults: Vault[] | undefined): string {
  const id = useSyncExternalStore(subscribe, currentVaultId, () => DEFAULT_VAULT);
  if (!vaults) return id;
  return vaults.some((vault) => vault.id === id) ? id : DEFAULT_VAULT;
}
