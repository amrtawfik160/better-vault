import type { Notebook, Note, Vault } from "@/lib/db/types";
import type { StudyOrigin, StudyRecord } from "./records";

export function studyOriginRecordId(origin: StudyOrigin | undefined) {
  switch (origin?.kind) {
    case "book":
      return origin.bookId;
    case "tutor":
    case "report":
      return origin.threadId;
    case "card":
      return origin.cardId;
    case "word":
      return origin.wordId;
  }
}

export function studyVaultIndex({
  rows,
  notebooks,
  notes,
  vaults,
  defaultVaultId,
}: {
  rows: readonly StudyRecord[];
  notebooks: readonly Pick<Notebook, "id" | "vaultId">[];
  notes: readonly Pick<Note, "id" | "vaultId" | "notebookId">[];
  vaults: readonly Pick<Vault, "id">[];
  defaultVaultId: string;
}) {
  const knownVaults = new Set([defaultVaultId, ...vaults.map(({ id }) => id)]);
  const liveVault = (id: string | undefined) => (id && knownVaults.has(id) ? id : undefined);
  const notebookVaults = new Map(
    notebooks.map((notebook) => [notebook.id, notebook.vaultId ?? defaultVaultId]),
  );
  const notebookOwner = (id: string) => liveVault(notebookVaults.get(id));
  const noteVaults = new Map(
    notes.map((note) => [
      note.id,
      (note.notebookId ? notebookVaults.get(note.notebookId) : undefined) ?? note.vaultId,
    ]),
  );
  const records = new Map(rows.map((row) => [row.id, row]));
  const owners = new Map<string, string>();

  function owner(row: StudyRecord, visiting = new Set<string>()): string | undefined {
    const cached = owners.get(row.id);
    if (cached) return cached;
    if (visiting.has(row.id)) return;
    visiting.add(row.id);
    const inherited = (id: string | undefined) => {
      const target = id ? records.get(id) : undefined;
      return target ? owner(target, visiting) : undefined;
    };
    const origin = "origin" in row ? row.origin : undefined;
    const fromOrigin = () => {
      switch (origin?.kind) {
        case "note":
          return liveVault(noteVaults.get(origin.noteId));
        case "studio":
        case "source":
          return notebookOwner(origin.notebookId);
        default:
          return inherited(studyOriginRecordId(origin));
      }
    };
    const vault =
      (row.notebookId ? notebookOwner(row.notebookId) : undefined) ??
      ("bookId" in row ? inherited(row.bookId) : undefined) ??
      fromOrigin() ??
      (row.kind === "session" ? inherited(row.itemId) : undefined) ??
      liveVault(row.vaultId);
    visiting.delete(row.id);
    if (vault) owners.set(row.id, vault);
    return vault;
  }

  return {
    owner: (row: StudyRecord) => owner(row) ?? defaultVaultId,
    notebookOwner,
    noteOwner: (id: string) => liveVault(noteVaults.get(id)) ?? defaultVaultId,
    linkedVault: (params: URLSearchParams) => {
      for (const key of ["book", "thread", "card", "highlight", "word"] as const) {
        const id = params.get(key);
        const row = id ? records.get(id) : undefined;
        if (row?.kind === key) return owner(row) ?? defaultVaultId;
      }
      const notebook = params.get("notebook");
      const ownerOfNotebook = notebook ? notebookOwner(notebook) : undefined;
      if (ownerOfNotebook) return ownerOfNotebook;
      const output = params.get("output");
      if (output) {
        const card = rows.find(
          (row) =>
            row.kind === "card" && row.origin?.kind === "studio" && row.origin.outputId === output,
        );
        if (card) return owner(card) ?? defaultVaultId;
      }
      return liveVault(params.get("vault") ?? undefined);
    },
  };
}
