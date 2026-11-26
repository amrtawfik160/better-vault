import {
  AiBrain01Icon,
  CloudServerIcon,
  InformationCircleIcon,
  PaintBoardIcon,
  Settings01Icon,
  PlugSocketIcon,
  AiVoiceIcon,
} from "@hugeicons/core-free-icons";
import { useNavigate } from "react-router";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Icon } from "@/components/icon";
import { Button } from "@/components/panelui/button";
import { Sheet } from "@/components/panelui/sheet";
import { useTheme } from "@/components/providers/theme-provider";
import { providerIds } from "@/lib/ai/catalog";
import { deleteAllData } from "@/lib/db/backup";
import { isProviderReady, useSettings } from "@/lib/db/settings";
import { getLanguage } from "@/lib/i18n/config";
import { useUpdates } from "@/lib/updates/use-updates";
import { appVersion } from "@/lib/version";
import { Avatar } from "@/components/account/avatar";
import { useProfile } from "@/lib/db/profile";
import { AboutPanel } from "./about-panel";
import { AccountPanel } from "./account-panel";
import { StoragePanel } from "./storage-panel";
import { StudioPanel } from "./studio-panel";
import { McpPanel, useMcpRunning } from "./mcp-panel";
import { PluginsPanel } from "./plugins-panel";
import { usePlugins } from "@/lib/db/plugins";
import { useAccount } from "@/lib/account/account";
import { storageIds } from "@/lib/storage/catalog";
import { isStorageReady, useStorageSettings } from "@/lib/storage/settings";
import { AppearancePanel } from "./appearance-panel";
import { CalendarPanel } from "./calendar-panel";
import { CalendarSubscribeDialog } from "./calendar-subscribe-dialog";
import { ChatGPTDialog } from "./chatgpt-dialog";
import { DataPanel } from "./data-panel";
import { LanguagePanel } from "./language-panel";
import { ReadingVoicePanel } from "./reading-voice-panel";
import { CliProxyPanel } from "./cliproxyapi-sign-in";
import {
  subscriptionConnectionsAllowed,
  useSubscriptionConnections,
} from "@/lib/ai/cliproxyapi-client";
import { ProvidersPanel } from "./providers-panel";
import { SettingsRow } from "./settings-row";
import { routes } from "@/lib/routes";

interface SettingsSheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The button that opens the sheet, with its own content. Default: a round ghost button with the gear. */
  trigger?: ReactElement;
  /** A page (`appearance`, `providers`, …) to open on top as soon as the sheet opens. */
  page?: SettingsPage | null;
}

export const settingsPages = [
  "account",
  "providers",
  "subscriptions",
  "storage",
  "appearance",
  "studio",
  "mcp",
  "plugins",
  "calendar",
  "language",
  "voice",
  "data",
  "about",
] as const;
export type SettingsPage = (typeof settingsPages)[number];
export type SettingsGroup =
  "ai" | "reading" | "account" | "storage" | "appearance" | "tools" | "about";

/** The group that holds each page. */
export const groupOf: Record<SettingsPage, SettingsGroup> = {
  providers: "ai",
  subscriptions: "ai",
  studio: "ai",
  voice: "reading",
  account: "account",
  storage: "storage",
  data: "storage",
  appearance: "appearance",
  language: "appearance",
  calendar: "tools",
  mcp: "tools",
  plugins: "tools",
  about: "about",
};

/**
 * Opens one of the sheet's pages from code: it presses a hidden trigger for
 * that page, the way a row would be pressed.
 */
function OpenPage({ page }: { page: SettingsPage }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => button.current?.click(), 0);
    return () => clearTimeout(timer);
  }, [page]);
  return (
    <Sheet.Trigger
      to={`group-${groupOf[page]}`}
      render={<button ref={button} type="button" hidden aria-hidden tabIndex={-1} />}
    />
  );
}

/** One group's page: its title and detail, then its sections. */
function GroupPage({ id, children }: { id: SettingsGroup; children: ReactNode }) {
  const { t } = useTranslation("settings");
  return (
    <>
      <Sheet.Header title={t(`groups.${id}.label`)} description={t(`groups.${id}.lead`)} />
      <Sheet.Body>
        <div className="flex flex-col gap-8 pb-4">{children}</div>
      </Sheet.Body>
    </>
  );
}

/**
 * General settings: seven groups. Each opens a sheet of its own on top, with
 * its sections one under another. Each a sheet of its own on top. A choice that
 * needs a dialog closes the sheets first.
 */
export function SettingsSheet({ open: openProp, onOpenChange, trigger, page }: SettingsSheetProps) {
  const { t, i18n } = useTranslation("settings");
  const navigate = useNavigate();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [chatGPTOpen, setChatGPTOpen] = useState(false);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const { t: tCommon } = useTranslation();
  const { theme } = useTheme();
  const settings = useSettings();
  const updates = useUpdates();
  const profile = useProfile();
  const storage = useStorageSettings();
  const account = useAccount();
  const subscriptions = useSubscriptionConnections();
  const mcpRunning = useMcpRunning();
  const pluginsOn = usePlugins()?.filter((plugin) => plugin.enabled).length ?? 0;
  const connected = storage ? storageIds.filter((id) => isStorageReady(storage, id)).length : 0;
  const updateVersion =
    updates.state.status === "available" ||
    updates.state.status === "downloading" ||
    updates.state.status === "ready"
      ? updates.state.version
      : null;
  const ready = settings ? providerIds.filter((id) => isProviderReady(settings, id)).length : 0;
  const toolsActive = [
    mcpRunning ? t("rows.mcpOn") : null,
    pluginsOn > 0 ? `${t("rows.plugins")}: ${t("rows.pluginsHint", { count: pluginsOn })}` : null,
  ].filter(Boolean);
  const toolsHint = toolsActive.length ? toolsActive.join(" · ") : t("groups.tools.detail");
  const aiHint = ready > 0 ? t("rows.providersHint", { count: ready }) : t("groups.ai.detail");

  return (
    <>
      <Sheet side="left" open={open} onOpenChange={setOpen}>
        {trigger ? (
          <Sheet.Trigger render={trigger} />
        ) : (
          <Sheet.Trigger
            render={<Button variant="ghost" shape="pill" size="icon" aria-label={t("title")} />}
          >
            <Icon icon={Settings01Icon} />
          </Sheet.Trigger>
        )}
        <Sheet.Content closeLabel={tCommon("actions.close")}>
          <Sheet.Header title={t("title")} description={t("description")} />
          {page ? <OpenPage page={page} /> : null}
          <Sheet.Body>
            <nav aria-label={t("title")} className="-mx-2 flex flex-col gap-0.5">
              <SettingsRow
                to="group-ai"
                icon={AiBrain01Icon}
                label={t("groups.ai.label")}
                hint={aiHint}
                end={
                  subscriptions.accounts.some(({ status }) => status === "connected") ? (
                    <span aria-hidden className="size-2 rounded-full bg-success" />
                  ) : undefined
                }
              />
              <SettingsRow
                to="group-reading"
                icon={AiVoiceIcon}
                label={t("groups.reading.label")}
                hint={t("groups.reading.detail")}
              />
              <SettingsRow
                to="group-account"
                icon={
                  <Avatar
                    profile={
                      profile && {
                        ...profile,
                        avatar: profile.avatar ?? account?.user.image ?? null,
                      }
                    }
                    size={36}
                  />
                }
                label={t("groups.account.label")}
                hint={
                  account
                    ? account.user.email
                    : profile?.name
                      ? profile.name
                      : t("groups.account.detail")
                }
              />
              <SettingsRow
                to="group-storage"
                icon={CloudServerIcon}
                label={t("groups.storage.label")}
                hint={
                  connected > 0
                    ? t("rows.storageHint", { count: connected })
                    : t("groups.storage.detail")
                }
              />
              <SettingsRow
                to="group-appearance"
                icon={PaintBoardIcon}
                label={t("groups.appearance.label")}
                hint={`${t(`appearance.${theme}`)} · ${getLanguage(i18n.language).nativeName}`}
              />
              <SettingsRow
                to="group-tools"
                icon={PlugSocketIcon}
                label={t("groups.tools.label")}
                hint={toolsHint}
              />
              <SettingsRow
                to="group-about"
                icon={InformationCircleIcon}
                label={t("groups.about.label")}
                hint={
                  updateVersion
                    ? t("updates.availableShort", { version: updateVersion })
                    : t("about.version", { version: appVersion })
                }
                end={
                  updateVersion ? (
                    <span aria-hidden className="size-2 rounded-full bg-info" />
                  ) : undefined
                }
              />
            </nav>
          </Sheet.Body>

          <Sheet.Next name="group-ai" closeLabel={tCommon("actions.close")}>
            <GroupPage id="ai">
              {subscriptionConnectionsAllowed() ? (
                <CliProxyPanel saved={settings?.providers.cliproxyapi} />
              ) : null}
              <ProvidersPanel
                onChatGPTSignIn={() => {
                  setOpen(false);
                  setChatGPTOpen(true);
                }}
              />
              <StudioPanel />
            </GroupPage>
          </Sheet.Next>
          <Sheet.Next name="group-reading" closeLabel={tCommon("actions.close")}>
            <GroupPage id="reading">
              <ReadingVoicePanel />
            </GroupPage>
          </Sheet.Next>
          <Sheet.Next name="group-account" closeLabel={tCommon("actions.close")}>
            <GroupPage id="account">
              <AccountPanel />
            </GroupPage>
          </Sheet.Next>
          <Sheet.Next name="group-storage" closeLabel={tCommon("actions.close")}>
            <GroupPage id="storage">
              <StoragePanel />
              <DataPanel
                onDeleteAll={() => {
                  setOpen(false);
                  setConfirmDeleteAll(true);
                }}
              />
            </GroupPage>
          </Sheet.Next>
          <Sheet.Next name="group-appearance" closeLabel={tCommon("actions.close")}>
            <GroupPage id="appearance">
              <AppearancePanel />
              <LanguagePanel />
            </GroupPage>
          </Sheet.Next>
          <Sheet.Next name="group-tools" closeLabel={tCommon("actions.close")}>
            <GroupPage id="tools">
              <CalendarPanel
                onSubscribe={() => {
                  setOpen(false);
                  setSubscribeOpen(true);
                }}
              />
              <McpPanel />
              <PluginsPanel />
            </GroupPage>
          </Sheet.Next>
          <Sheet.Next name="group-about" closeLabel={tCommon("actions.close")}>
            <GroupPage id="about">
              <AboutPanel updates={updates} />
            </GroupPage>
          </Sheet.Next>
        </Sheet.Content>
      </Sheet>
      <ChatGPTDialog open={chatGPTOpen} onOpenChange={setChatGPTOpen} />
      <CalendarSubscribeDialog open={subscribeOpen} onOpenChange={setSubscribeOpen} />
      <ConfirmDialog
        open={confirmDeleteAll}
        onOpenChange={setConfirmDeleteAll}
        title={t("data.deleteAllConfirm.title")}
        body={t("data.deleteAllConfirm.body")}
        confirmLabel={t("data.deleteAllConfirm.confirm")}
        onConfirm={async () => {
          await deleteAllData();
          toast.success(t("data.deleted"));
          navigate(routes.home);
        }}
      />
    </>
  );
}
