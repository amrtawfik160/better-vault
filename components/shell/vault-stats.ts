import { useMemo } from "react";
import { useStudyClock } from "@/components/study/use-study-clock";
import { useNotebooks } from "@/lib/db/notebooks";
import { useNotes } from "@/lib/db/notes";
import { useSettings } from "@/lib/db/settings";
import { useStudyRecords } from "@/lib/db/study";
import type { Vault } from "@/lib/db/types";
import { DEFAULT_VAULT } from "@/lib/db/vaults";
import type { StudyRecordOf } from "@/lib/study/records";
import { dailyReview } from "@/lib/study/review-session";
import { studyVaultIndex } from "@/lib/study/vault";
import { vaultStats } from "./nav-model";

export type { VaultStats } from "./nav-model";

/** `vaultStats` for the vaults given, kept live. `undefined` while loading. */
export function useVaultStats(vaults: Vault[] | undefined, current: string) {
  const notebooks = useNotebooks();
  const notes = useNotes();
  const rows = useStudyRecords();
  const settings = useSettings();
  const acrossVaults = Boolean(settings?.study?.reviewAcrossVaults);
  const scheduled = useMemo(
    () => (rows ?? []).filter(
        (row): row is StudyRecordOf<"card" | "highlight"> => row.kind === "card" || row.kind === "highlight",
      ),
    [rows],
  );
  const now = useStudyClock(scheduled);
  return useMemo(() => {
    if (!vaults || !notebooks || !notes || !rows) return undefined;
    const scope = studyVaultIndex({ rows, notebooks, notes, vaults, defaultVaultId: DEFAULT_VAULT });
    return vaultStats({
      vaults,
      notebooks,
      rows: rows.filter((row) => row.kind !== "document-draft" && row.kind !== "ocr-draft"),
      owner: (row) => scope.owner(row) ?? DEFAULT_VAULT,
      dueCount: (review) => dailyReview(review, now).due.length,
      current,
      acrossVaults,
    });
  }, [vaults, notebooks, notes, rows, now, current, acrossVaults]);
}
