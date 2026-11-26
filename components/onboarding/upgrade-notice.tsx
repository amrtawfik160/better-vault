import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/panelui/button";
import { Dialog } from "@/components/panelui/dialog";
import { updateSettings } from "@/lib/db/settings";

const items = ["notebooks", "chats", "review"] as const;

/** A one-time note to people who used the app before the redesign. */
export function UpgradeNotice() {
  const { t } = useTranslation("onboarding");
  const { t: tCommon } = useTranslation();
  const [open, setOpen] = useState(true);

  function dismiss() {
    setOpen(false);
    void updateSettings((settings) => {
      settings.upgradeNoticeSeen = true;
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()}>
      <Dialog.Content size="md" closeLabel={tCommon("actions.close")}>
        <Dialog.Header title={t("upgrade.title")} description={t("upgrade.eyebrow", { app: tCommon("appName") })} />
        <Dialog.Body>
          <ul className="flex flex-col gap-4">
            {items.map((id) => (
              <li key={id} className="flex flex-col gap-0.5">
                <p className="text-sm font-medium text-foreground">{t(`upgrade.${id}`)}</p>
                <p className="text-sm leading-6 text-muted-foreground">{t(`upgrade.${id}Body`)}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">{t("upgrade.footer")}</p>
        </Dialog.Body>
        <Dialog.Footer>
          <Button onClick={dismiss}>{t("upgrade.done")}</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
