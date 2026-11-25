import {
  Add01Icon,
  Delete02Icon,
  PencilEdit01Icon,
  Settings02Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { NotebookDialog } from "@/components/home/notebook-dialog";
import { useVaultName } from "@/components/home/vault-name";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Dialog } from "@/components/panelui/dialog";
import { Menu } from "@/components/panelui/menu";
import type { Vault } from "@/lib/db/types";
import { DEFAULT_VAULT, createVault, deleteVault, updateVault } from "@/lib/db/vaults";
import { cn } from "@/lib/utils";
import { monogram } from "./nav-model";
import type { VaultStats } from "./vault-stats";

/** A vault's first letter on a small square: the sign of a vault in the sidebar and its switcher. */
export function VaultMonogram({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-sm bg-muted text-xs font-semibold text-foreground inset-ring inset-ring-border",
        className,
      )}
    >
      {monogram(name)}
    </span>
  );
}

/** "3 notebooks · 12 due", for a vault's row. */
export function useVaultCountLine() {
  const { t } = useTranslation("shell");
  return (stats: VaultStats | undefined) =>
    stats
      ? [
          t("vault.notebooks", { count: stats.notebooks }),
          stats.due ? t("vault.due", { count: stats.due }) : t("vault.nothingDue"),
        ].join(" · ")
      : "";
}

/**
 * The vault switcher at the top of the sidebar: the current vault's name
 * (always visible), opening a menu of the vaults with what each holds, then
 * New vault and Manage vaults.
 */
export function VaultSwitcher({
  vaults,
  current,
  stats,
  rail,
  onSwitch,
}: {
  vaults: Vault[];
  current: Vault;
  stats: Map<string, VaultStats> | undefined;
  /** Drawn as the monogram only, in the icon rail. */
  rail: boolean;
  onSwitch: (id: string) => void;
}) {
  const { t } = useTranslation("shell");
  const { t: tHome } = useTranslation("home");
  const vaultName = useVaultName();
  const countLine = useVaultCountLine();
  const noteId = useId();
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const name = vaultName(current);

  return (
    <>
      <Menu>
        <Menu.Trigger
          aria-label={t("vault.switch", { name })}
          title={name}
          className={cn(
            "flex h-9 min-w-0 cursor-pointer items-center gap-2 rounded-md text-start text-[0.8125rem] leading-5 font-medium text-foreground outline-none transition-colors duration-150 hover:bg-foreground/5 focus-visible:ring-[3px] focus-visible:ring-ring/40 data-popup-open:bg-muted max-md:h-11",
            rail ? "mx-auto size-10 justify-center px-0" : "flex-1 px-2",
          )}
        >
          <VaultMonogram name={name} />
          {rail ? null : (
            <>
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <Icon icon={UnfoldMoreIcon} size={14} strokeWidth={1.5} className="text-muted-foreground" />
            </>
          )}
        </Menu.Trigger>
        <Menu.Content align="start" className="w-65" aria-describedby={noteId}>
          <Menu.Group>
            <Menu.GroupLabel>{t("vault.title")}</Menu.GroupLabel>
            <Menu.RadioGroup
              value={current.id}
              onValueChange={(next: unknown) => {
                if (typeof next === "string" && next !== current.id) onSwitch(next);
              }}
            >
              {vaults.map((vault) => (
                <Menu.RadioItem key={vault.id} value={vault.id} closeOnClick className="min-h-11">
                  <VaultMonogram name={vaultName(vault)} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[0.8125rem] leading-5 font-medium">
                      {vaultName(vault)}
                    </span>
                    <span className="truncate text-xs text-muted-foreground tabular-nums">
                      {countLine(stats?.get(vault.id))}
                    </span>
                  </span>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Group>
          <Menu.Separator />
          <Menu.Item onClick={() => setCreating(true)}>
            <Icon icon={Add01Icon} />
            {t("vault.new")}
          </Menu.Item>
          <Menu.Item onClick={() => setManaging(true)}>
            <Icon icon={Settings02Icon} />
            {t("vault.manage")}
          </Menu.Item>
          <p id={noteId} className="px-2 pt-1 pb-1.5 text-xs text-pretty whitespace-normal text-muted-foreground">
            {t("vault.note")}
          </p>
        </Menu.Content>
      </Menu>

      <NotebookDialog
        open={creating}
        onOpenChange={setCreating}
        mode="create"
        folders={[]}
        initial={{ title: "", icon: "notebook" }}
        labels={{
          title: tHome("vaults.createTitle"),
          description: tHome("vaults.createDescription"),
          submit: tHome("vaults.create"),
          placeholder: tHome("vaults.untitled"),
        }}
        onSubmit={async ({ title, icon, color }) => {
          const id = await createVault({ name: title, icon, color });
          onSwitch(id);
        }}
      />
      <ManageVaults
        open={managing}
        onOpenChange={setManaging}
        vaults={vaults}
        current={current.id}
        stats={stats}
      />
    </>
  );
}

/** Every vault with its counts, to rename, restyle or delete one. */
function ManageVaults({
  open,
  onOpenChange,
  vaults,
  current,
  stats,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vaults: Vault[];
  current: string;
  stats: Map<string, VaultStats> | undefined;
}) {
  const { t } = useTranslation("shell");
  const { t: tHome } = useTranslation("home");
  const { t: tCommon } = useTranslation();
  const vaultName = useVaultName();
  const countLine = useVaultCountLine();
  // One dialog at a time: Edit and Delete close this list first.
  const [editing, setEditing] = useState<Vault | null>(null);
  const [deleting, setDeleting] = useState<Vault | null>(null);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <Dialog.Content size="md" closeLabel={tCommon("actions.close")}>
          <Dialog.Header title={t("vault.manageTitle")} description={t("vault.manageDescription")} />
          <Dialog.Body>
            <ul className="-mx-1 flex flex-col">
              {vaults.map((vault) => {
                const name = vaultName(vault);
                return (
                  <li
                    key={vault.id}
                    className="flex min-h-11 items-center gap-3 border-b px-1 py-1.5 last:border-b-0"
                  >
                    <VaultMonogram name={name} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">
                        {name}
                        {vault.id === current ? (
                          <span className="ms-2 text-xs font-normal text-muted-foreground">
                            {t("vault.current")}
                          </span>
                        ) : null}
                      </span>
                      <span className="truncate text-xs text-muted-foreground tabular-nums">
                        {countLine(stats?.get(vault.id))}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("vault.edit", { name })}
                      title={t("vault.edit", { name })}
                      onClick={() => {
                        onOpenChange(false);
                        setEditing(vault);
                      }}
                    >
                      <Icon icon={PencilEdit01Icon} size={16} />
                    </Button>
                    {vault.id === DEFAULT_VAULT ? null : (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("vault.delete", { name })}
                        title={t("vault.delete", { name })}
                        onClick={() => {
                          onOpenChange(false);
                          setDeleting(vault);
                        }}
                      >
                        <Icon icon={Delete02Icon} size={16} />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog>
      <NotebookDialog
        open={editing !== null}
        onOpenChange={(next) => !next && setEditing(null)}
        mode="edit"
        folders={[]}
        initial={{
          title: editing ? vaultName(editing) : "",
          icon: editing?.icon ?? "notebook",
          color: editing?.color,
        }}
        labels={{
          title: tHome("vaults.editTitle"),
          submit: tHome("vaults.create"),
          placeholder: tHome("vaults.untitled"),
        }}
        onSubmit={async ({ title, icon, color }) => {
          if (editing) await updateVault(editing.id, { name: title, icon, color });
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={tHome("vaults.deleteTitle", { name: deleting ? vaultName(deleting) : "" })}
        body={tHome("vaults.deleteBody")}
        confirmLabel={tHome("vaults.deleteConfirm")}
        onConfirm={() => (deleting ? deleteVault(deleting.id) : undefined)}
      />
    </>
  );
}
