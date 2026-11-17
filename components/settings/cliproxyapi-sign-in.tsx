import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Field } from "@/components/common/field";
import { Button, buttonVariants } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import {
  cliProxyLoginSchema,
  cliProxyLoginStatusSchema,
  cliProxySignInProviders,
  type CliProxySignInProvider,
} from "@/lib/ai/cliproxyapi-oauth";

const names: Record<CliProxySignInProvider, string> = {
  codex: "ChatGPT (Codex)",
  claude: "Claude",
  antigravity: "Antigravity",
};

const errorSchema = z.object({ error: z.string() });
type SignInRequest = { key: string } & (
  | { action: "start"; provider: CliProxySignInProvider }
  | { action: "status" | "cancel"; state: string }
);

async function signInRequest<T>(
  body: SignInRequest,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api/cliproxyapi/oauth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const error = errorSchema.safeParse(result);
    if (error.success) throw new Error(error.data.error);
  }
  return schema.parse(result);
}

type PendingLogin = { provider: CliProxySignInProvider; url: string; state: string };

export function CliProxySignIn() {
  const { t } = useTranslation("settings");
  const keyId = useId();
  const [key, setKey] = useState("");
  const [login, setLogin] = useState<PendingLogin | null>(null);
  const [connected, setConnected] = useState<CliProxySignInProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!login || busy) return;
    const controller = new AbortController();
    let timer = window.setTimeout(poll, 1500);

    async function poll() {
      if (!login) return;
      try {
        const { status } = await signInRequest(
          { action: "status", key, state: login.state },
          cliProxyLoginStatusSchema,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (status === "wait") {
          timer = window.setTimeout(poll, 1500);
        } else {
          setLogin(null);
          if (status === "ok") setConnected(login.provider);
          else setError(t("cliproxyapi.signInFailed"));
        }
      } catch {
        if (controller.signal.aborted) return;
        setError(t("cliproxyapi.statusFailed"));
        setLogin(null);
      }
    }

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [login, busy, key, t]);

  async function start(provider: CliProxySignInProvider) {
    setBusy(true);
    setError("");
    setConnected(null);
    try {
      const { state, url } = await signInRequest(
        { action: "start", key, provider },
        cliProxyLoginSchema,
      );
      setLogin({ state, url, provider });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : t("cliproxyapi.signInFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!login) return;
    setBusy(true);
    setError("");
    try {
      await signInRequest({ action: "cancel", key, state: login.state }, cliProxyLoginStatusSchema);
      setLogin(null);
    } catch {
      setError(t("cliproxyapi.cancelFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-muted/60 p-4">
      <h3 className="text-sm font-medium">{t("cliproxyapi.signIn")}</h3>
      <p className="text-sm text-muted-foreground">{t("cliproxyapi.signInHint")}</p>
      <Field
        label={t("cliproxyapi.managementKey")}
        htmlFor={keyId}
        action={
          <a
            href="https://help.router-for.me/introduction/quick-start"
            target="_blank"
            rel="noreferrer"
          >
            {t("cliproxyapi.setup")}
          </a>
        }
      >
        <Input
          id={keyId}
          aria-label={t("cliproxyapi.managementKey")}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          disabled={busy || login !== null}
        />
      </Field>
      {login ? (
        <div className="flex flex-wrap gap-2">
          <a
            href={login.url}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ size: "sm" })}
          >
            {t("cliproxyapi.openSignIn", { provider: names[login.provider] })}
          </a>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={cancel}>
            {t("cliproxyapi.cancel")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {cliProxySignInProviders.map((provider) => (
            <Button
              key={provider}
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy || !key.trim()}
              onClick={() => void start(provider)}
            >
              {names[provider]}
            </Button>
          ))}
        </div>
      )}
      <div role="status" className="text-sm text-muted-foreground empty:hidden">
        {busy
          ? t(login ? "cliproxyapi.cancelling" : "cliproxyapi.starting")
          : login
            ? t("cliproxyapi.waiting")
            : connected
              ? t("cliproxyapi.connected", { provider: names[connected] })
              : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
