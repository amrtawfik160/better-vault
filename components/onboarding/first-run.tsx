import { useState } from "react";
import { providerIds } from "@/lib/ai/catalog";
import { useNotebooks } from "@/lib/db/notebooks";
import { isProviderReady, useSettings } from "@/lib/db/settings";
import { OnboardingDialog } from "./onboarding-dialog";
import { UpgradeNotice } from "./upgrade-notice";
import { firstScreen, type FirstScreen } from "./visibility";

/**
 * Shows the first-run flow to a newcomer or the one-time upgrade notice to
 * someone who already used the app. The choice is made once the data has
 * loaded and then kept, so adding material mid-flow does not swap it.
 */
export function FirstRun() {
  const settings = useSettings();
  const notebooks = useNotebooks();
  const [chosen, setChosen] = useState<FirstScreen | null>(null);
  if (chosen === null && settings && notebooks) {
    setChosen(
      firstScreen({
        onboardingDone: settings.onboardingDone === true,
        upgradeNoticeSeen: settings.upgradeNoticeSeen === true,
        notebookCount: notebooks.length,
        hasModel: providerIds.some((id) => isProviderReady(settings, id)),
      }),
    );
  }
  if (chosen === "onboarding") return <OnboardingDialog />;
  if (chosen === "upgrade") return <UpgradeNotice />;
  return null;
}
