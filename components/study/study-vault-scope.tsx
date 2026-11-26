import { createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/panelui/switch";
import { updateSettings, useSettings } from "@/lib/db/settings";
import type { StudyRecord } from "@/lib/study/records";
import { cn } from "@/lib/utils";

/**
 * Which vault each Study item is in, for the parts of Study that can show
 * items of every vault ("Review across vaults" in the Study settings).
 */
export type StudyVaultScope = {
  /** Review, Today's due counts and saved words read every vault. */
  acrossVaults: boolean;
  /** The vault a row is in. */
  vaultOf: (row: StudyRecord) => string | undefined;
  /** The vault name to show on a row, while items of every vault are shown. */
  label: (row: StudyRecord) => string | undefined;
};

export const StudyVaultScopeContext = createContext<StudyVaultScope>({
  acrossVaults: false,
  vaultOf: () => undefined,
  label: () => undefined,
});

export function useStudyVaultScope() {
  return useContext(StudyVaultScopeContext);
}

/** A row's vault, shown as a small label while Review reads every vault. */
export function StudyVaultLabel({ row, className }: { row: StudyRecord; className?: string }) {
  const name = useStudyVaultScope().label(row);
  return name ? (
    <span
      className={cn("inline-flex max-w-40 shrink-0 truncate rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground", className)}
      dir="auto"
    >
      {name}
    </span>
  ) : null;
}

/** Turns "Review across vaults" on or off. `compact` leaves out the explanation, for Review's header. */
export function StudyAcrossVaultsSwitch({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { t } = useTranslation("home");
  const settings = useSettings();
  return (
    <label className={cn("flex cursor-pointer items-center gap-3", className)}>
      <Switch
        size="sm"
        checked={settings?.study?.reviewAcrossVaults ?? false}
        disabled={!settings}
        onCheckedChange={(reviewAcrossVaults) =>
          void updateSettings((saved) => {
            saved.study = { ...saved.study, reviewAcrossVaults };
          })
        }
      />
      {compact ? (
        <span title={t("study.review.acrossVaultsHint")}>{t("study.review.acrossVaults")}</span>
      ) : (
        <span className="grid gap-0.5">
          <span>{t("study.review.acrossVaults")}</span>
          <span className="text-xs text-muted-foreground">{t("study.review.acrossVaultsHint")}</span>
        </span>
      )}
    </label>
  );
}
