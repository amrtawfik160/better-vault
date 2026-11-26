import type { StudyRecord } from "./records";

/** What Review and Today's due counts read from other vaults: what is reviewed, its history, and the books of highlights. */
const reviewKinds = new Set<StudyRecord["kind"]>(["card", "highlight", "word", "session", "book"]);

/**
 * The Study rows each part of Study reads. Reading, Library and Practice use
 * `rows`, the current vault's. With `acrossVaults` on, Review and Today's due
 * counts (`review`) and the Collection (`collection`, for its words) also read
 * other vaults. Nothing moves: each row stays in its vault.
 */
export function studyVaultViews<Row extends StudyRecord>(
  rows: readonly Row[],
  owner: (row: Row) => string,
  vaultId: string,
  acrossVaults: boolean,
) {
  const inVault = rows.filter((row) => owner(row) === vaultId);
  if (!acrossVaults) return { rows: inVault, review: inVault, collection: inVault };
  return {
    rows: inVault,
    review: rows.filter((row) => owner(row) === vaultId || reviewKinds.has(row.kind)),
    collection: rows.filter((row) => owner(row) === vaultId || row.kind === "word"),
  };
}

/** Ids grouped by the vault each item is in, in the order first seen, for writes that act in one vault. */
export function studyIdsByVault<Item extends { id: string }>(
  items: readonly Item[],
  vaultOf: (item: Item) => string,
): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const vault = vaultOf(item);
    groups.set(vault, [...(groups.get(vault) ?? []), item.id]);
  }
  return [...groups];
}

/** The vault every one of these rows is in, or `fallback` when they are spread over several or unknown. */
export function sharedStudyVault<Row extends { id: string }>(
  ids: readonly string[],
  rows: readonly Row[],
  owner: (row: Row) => string,
  fallback: string,
) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const vaults = new Set(
    ids.map((id) => {
      const row = byId.get(id);
      return row ? owner(row) : fallback;
    }),
  );
  return vaults.size === 1 ? [...vaults][0] : fallback;
}
