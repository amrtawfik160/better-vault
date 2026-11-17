import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button, buttonVariants } from "@/components/panelui/button";
import { Sheet } from "@/components/panelui/sheet";
import {
  cliProxyLoginSchema,
  cliProxyLoginStatusSchema,
  cliProxySignInProviders,
  type CliProxySignInProvider,
} from "@/lib/ai/cliproxyapi-oauth";
import { updateProvider, type ProviderSettings } from "@/lib/db/settings";
import { desktopBridge } from "@/lib/desktop/bridge";

const names: Record<CliProxySignInProvider, string> = {
  codex: "ChatGPT",
  claude: "Claude",
  antigravity: "Antigravity",
};

const errorSchema = z.object({ error: z.string() });
const modelsSchema = z.object({
  models: z.array(z.string()),
  contextTokens: z.record(z.string(), z.number()),
});

async function request<T>(path: string, body: object, schema: z.ZodType<T>, signal?: AbortSignal) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const error = errorSchema.safeParse(result);
    throw new Error(error.success ? error.data.error : response.statusText);
  }
  return schema.parse(result);
}

const oauth = "/api/cliproxyapi/oauth";

async function syncModels(signal?: AbortSignal) {
  const result = await request(
    "/api/models",
    { provider: "cliproxyapi", credentials: {} },
    modelsSchema,
    signal,
  );
  if (signal?.aborted) return;
  await updateProvider("cliproxyapi", { ...result, enabled: result.models.length > 0, apiKey: "" });
}

type PendingLogin = {
  provider: CliProxySignInProvider;
  url: string;
  state: string;
  opened: boolean;
};

export function CliProxyPanel({ saved }: { saved: ProviderSettings }) {
  const { t } = useTranslation("settings");
  const popupRef = useRef<Window | null>(null);
  const [login, setLogin] = useState<PendingLogin | null>(null);
  const [connected, setConnected] = useState<CliProxySignInProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void syncModels(controller.signal).catch((problem: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(problem));
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!login || busy) return;
    const controller = new AbortController();
    let timer = window.setTimeout(poll, 1500);

    async function poll() {
      if (!login) return;
      try {
        const { status } = await request(
          oauth,
          { action: "status", state: login.state },
          cliProxyLoginStatusSchema,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (status === "wait") {
          timer = window.setTimeout(poll, 1500);
          return;
        }
        if (status === "ok") {
          setConnected(login.provider);
          await syncModels(controller.signal);
        } else {
          setError(t("cliproxyapi.signInFailed"));
        }
      } catch (problem) {
        if (!controller.signal.aborted) setError(errorMessage(problem));
      }
      if (!controller.signal.aborted) setLogin(null);
    }

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [login, busy, t]);

  async function start(provider: CliProxySignInProvider) {
    setBusy(true);
    setError("");
    setConnected(null);
    const popup = desktopBridge() ? null : window.open("about:blank", "_blank");
    popupRef.current = popup;
    try {
      const { state, url, opened } = await request(
        oauth,
        { action: "start", provider },
        cliProxyLoginSchema,
      );
      let browserOpened = opened ?? false;
      if (popup && !popup.closed) {
        try {
          popup.opener = null;
          popup.location.href = url;
          browserOpened = true;
        } catch {
          popup.close();
        }
      }
      setLogin({ state, url, provider, opened: browserOpened });
    } catch (problem) {
      popup?.close();
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!login) return;
    setBusy(true);
    setError("");
    try {
      await request(oauth, { action: "cancel", state: login.state }, cliProxyLoginStatusSchema);
      popupRef.current?.close();
      setLogin(null);
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      await syncModels();
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <Sheet.Header title={t("cliproxyapi.title")} description={t("cliproxyapi.description")} />
      <Sheet.Body>
        <div className="flex flex-col gap-4">
          {login ? (
            <div className="flex flex-wrap gap-2">
              <a
                href={login.url}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: login.opened ? "secondary" : "default" })}
              >
                {t(login.opened ? "cliproxyapi.reopenSignIn" : "cliproxyapi.openSignIn", {
                  provider: names[login.provider],
                })}
              </a>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void cancel()}>
                {t("cliproxyapi.cancel")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-2">
              {cliProxySignInProviders.map((provider) => (
                <Button
                  key={provider}
                  type="button"
                  variant="secondary"
                  disabled={busy || refreshing}
                  onClick={() => void start(provider)}
                >
                  {t("cliproxyapi.connect", { provider: names[provider] })}
                </Button>
              ))}
            </div>
          )}
          <p role="status" className="text-sm text-muted-foreground">
            {busy
              ? t(login ? "cliproxyapi.cancelling" : "cliproxyapi.starting")
              : login
                ? t(login.opened ? "cliproxyapi.waiting" : "cliproxyapi.openPrompt")
                : connected
                  ? t("cliproxyapi.connected", { provider: names[connected] })
                  : saved.models.length > 0
                    ? t("providers.modelsLoaded", { count: saved.models.length })
                    : t("cliproxyapi.modelsEmpty")}
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="self-start"
            disabled={busy || refreshing || login !== null}
            onClick={() => void refresh()}
          >
            {refreshing ? t("providers.refreshing") : t("cliproxyapi.refreshModels")}
          </Button>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </Sheet.Body>
    </>
  );
}

function errorMessage(problem: unknown): string {
  return problem instanceof Error ? problem.message : String(problem);
}
