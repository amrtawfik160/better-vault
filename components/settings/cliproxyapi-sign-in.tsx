import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@/components/panelui/button";
import { Sheet } from "@/components/panelui/sheet";
import { ProviderIcon } from "@/components/provider-icon";
import {
  cancelSubscriptionLogin,
  disconnectSubscriptionAccount,
  refreshSubscriptionConnections,
  startSubscriptionLogin,
  useSubscriptionConnections,
} from "@/lib/ai/cliproxyapi-client";
import {
  cliProxyBrands,
  cliProxySignInProviders,
  type CliProxySignInProvider,
} from "@/lib/ai/cliproxyapi-oauth";
import type { ProviderSettings } from "@/lib/db/settings";

const brands: Record<CliProxySignInProvider, { logo?: string; darkLogo?: string }> = {
  codex: {},
  claude: { logo: "claude" },
  antigravity: { logo: "antigravity" },
  xai: { logo: "grok", darkLogo: "grok-dark" },
  kimi: { logo: "kimi-light", darkLogo: "kimi-dark" },
  "kimi-ai": {
    logo: "kimi-light",
    darkLogo: "kimi-dark",
  },
  devin: { logo: "devin", darkLogo: "devin-dark" },
  meta: { logo: "meta" },
};

function SubscriptionLogo({ provider }: { provider: CliProxySignInProvider }) {
  const { logo, darkLogo } = brands[provider];
  if (!logo) return <ProviderIcon provider="openai" className="size-5" />;
  return (
    <>
      <img
        src={`/providers/subscriptions/${logo}.svg`}
        alt=""
        width={20}
        height={20}
        className={
          darkLogo ? "size-5 shrink-0 object-contain dark:hidden" : "size-5 shrink-0 object-contain"
        }
      />
      {darkLogo ? (
        <img
          src={`/providers/subscriptions/${darkLogo}.svg`}
          alt=""
          width={20}
          height={20}
          className="hidden size-5 shrink-0 object-contain dark:block"
        />
      ) : null}
    </>
  );
}

export function CliProxyPanel({ saved }: { saved?: ProviderSettings }) {
  const { t } = useTranslation("settings");
  const { login, accounts, busy, refreshing, error } = useSubscriptionConnections();
  const [copiedCode, setCopiedCode] = useState("");
  const [copyError, setCopyError] = useState(false);
  const userCode = login?.userCode;

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <>
      <Sheet.Header title={t("cliproxyapi.title")} description={t("cliproxyapi.description")} />
      <Sheet.Body>
        <div className="flex flex-col gap-4">
          {login ? (
            <div className="flex flex-col gap-3">
              {userCode ? (
                <div className="flex flex-wrap items-center gap-2">
                  <code
                    dir="ltr"
                    className="rounded-lg bg-muted px-3 py-2 font-mono text-base font-semibold tracking-wide break-all select-all"
                  >
                    {userCode}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void copyCode(userCode)}
                  >
                    {t(copiedCode === userCode ? "cliproxyapi.codeCopied" : "cliproxyapi.copyCode")}
                  </Button>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <a
                  href={login.url}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: login.opened ? "secondary" : "default" })}
                >
                  {t(login.opened ? "cliproxyapi.reopenSignIn" : "cliproxyapi.openSignIn", {
                    provider: cliProxyBrands[login.provider],
                  })}
                </a>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void cancelSubscriptionLogin()}
                >
                  {t("cliproxyapi.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {cliProxySignInProviders
                .filter((provider) => !accounts.some((account) => account.provider === provider))
                .map((provider) => (
                  <Button
                    key={provider}
                    type="button"
                    variant="secondary"
                    className="h-auto min-h-11 min-w-0 justify-start px-3 py-2 text-start whitespace-normal"
                    aria-label={t("cliproxyapi.connect", { provider: cliProxyBrands[provider] })}
                    disabled={busy || refreshing}
                    onClick={() => void startSubscriptionLogin(provider)}
                  >
                    <SubscriptionLogo provider={provider} />
                    {cliProxyBrands[provider]}
                  </Button>
                ))}
            </div>
          )}
          {!login && accounts.length > 0 ? (
            <ul className="divide-y">
              {accounts.map((account) => (
                <li
                  key={account.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <SubscriptionLogo provider={account.provider} />
                    <div className="min-w-0">
                      <p className="font-medium">{cliProxyBrands[account.provider]}</p>
                      <p className="text-sm break-all text-muted-foreground">
                        {[account.email, t(`cliproxyapi.accountStatus.${account.status}`)]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void startSubscriptionLogin(account.provider, account.id)}
                    >
                      {t("cliproxyapi.reconnect")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void disconnectSubscriptionAccount(account.id)}
                    >
                      {t("cliproxyapi.disconnect")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <p role="status" className="text-sm text-muted-foreground">
            {busy
              ? t(login ? "cliproxyapi.cancelling" : "cliproxyapi.starting")
              : login
                ? t(
                    login.userCode
                      ? "cliproxyapi.devicePrompt"
                      : login.opened
                        ? "cliproxyapi.waiting"
                        : "cliproxyapi.openPrompt",
                  )
                : saved?.enabled
                  ? t("providers.modelsLoaded", { count: saved.models.length })
                  : t("cliproxyapi.modelsEmpty")}
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="self-start"
            disabled={busy || refreshing || login !== null}
            onClick={() => void refreshSubscriptionConnections()}
          >
            {refreshing ? t("providers.refreshing") : t("cliproxyapi.refreshModels")}
          </Button>
          {error || (userCode && copyError) ? (
            <p role="alert" className="text-sm text-destructive">
              {t(`cliproxyapi.${error ?? "copyCodeFailed"}`)}
            </p>
          ) : null}
        </div>
      </Sheet.Body>
    </>
  );
}
