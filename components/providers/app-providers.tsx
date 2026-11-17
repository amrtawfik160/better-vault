import { useEffect, type ReactNode } from "react";
import { CommandPalette } from "@/components/command/command-palette";
import { OnboardingGate } from "@/components/onboarding/onboarding";
import { Sheet } from "@/components/panelui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UpdatesHost } from "@/components/updates/updates-host";
import { monitorSubscriptionConnections } from "@/lib/ai/cliproxyapi-client";
import { refreshAccount } from "@/lib/account/account";
import { I18nProvider } from "./i18n-provider";
import { ThemeProvider } from "./theme-provider";

/** Everything the app needs around every page. */
export function AppProviders({ children }: { children: ReactNode }) {
  useEffect(monitorSubscriptionConnections, []);

  useEffect(() => {
    const refresh = () => void refreshAccount().catch(() => {});
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  return (
    <ThemeProvider>
      <I18nProvider>
        <TooltipProvider>
          {/* The page steps back while a sheet is open. */}
          <Sheet.Stage className="h-dvh">{children}</Sheet.Stage>
          <CommandPalette />
          <Toaster />
          <UpdatesHost />
          <OnboardingGate />
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
