import { useState } from "react";
import { useStoreQuery } from "@/lib/db/live";
import { useNotebooks } from "@/lib/db/notebooks";
import { useSettings } from "@/lib/db/settings";
import { store } from "@/lib/db/store";
import { UpgradeNotice } from "./upgrade-notice";
import { firstScreen, type FirstScreen } from "./visibility";

/**
 * The one-time note about the redesign, for someone who had already finished
 * the welcome screens. Decided once the data has loaded, then kept, so
 * finishing the welcome screens during this visit never brings it up.
 */
export function FirstRun() {
  const settings = useSettings();
  const notebooks = useNotebooks();
  const welcomed = useStoreQuery(
    async () => ((await store().getSetting("onboarding")) as { done?: boolean } | undefined)?.done === true,
    [],
    ["settings"],
  );
  const [chosen, setChosen] = useState<FirstScreen | null>(null);
  if (chosen === null && settings && notebooks && welcomed !== undefined) {
    setChosen(
      firstScreen({
        welcomed,
        upgradeNoticeSeen: settings.upgradeNoticeSeen === true,
        notebookCount: notebooks.length,
      }),
    );
  }
  return chosen === "upgrade" ? <UpgradeNotice /> : null;
}
