import { useEffect, type ReactNode } from "react";
import { CommandPalette } from "@/components/command/command-palette";
import { OnboardingGate } from "@/components/onboarding/onboarding";
import { PluginDialogs } from "@/components/plugins/plugin-dialog";
import { PluginMods } from "@/components/plugins/plugin-mods";
import { PluginThemes } from "@/components/plugins/plugin-themes";
import { Sheet } from "@/components/panelui/sheet";
import { ReadingVoiceToasts } from "@/components/speech/reading-voice-toasts";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UpdatesHost } from "@/components/updates/updates-host";
import { refreshAccount } from "@/lib/account/account";
import { monitorSubscriptionConnections } from "@/lib/ai/cliproxyapi-client";
import { I18nProvider } from "./i18n-provider";
import { AppFont } from "./app-font";
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
          <ReadingVoiceToasts />
          <UpdatesHost />
          <PluginThemes />
          <PluginMods />
          <PluginDialogs />
          <AppFont />
          <OnboardingGate />
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
