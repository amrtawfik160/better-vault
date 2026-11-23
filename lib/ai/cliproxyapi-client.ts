import { useSyncExternalStore } from "react";
import { z } from "zod";
import { updateProvider } from "@/lib/db/settings";
import { desktopBridge } from "@/lib/desktop/bridge";
import {
  cliProxyErrorSchema,
  cliProxyLoginSchema,
  cliProxyLoginStatusSchema,
  cliProxySignInProviders,
  cliProxySnapshotSchema,
  type CliProxyAccount,
  type CliProxyError,
  type CliProxySignInProvider,
} from "./cliproxyapi-oauth";

const endpoint = "/api/cliproxyapi/oauth";
const storageKey = "ai-subscription-sign-in";
const expiredAfter = 10 * 60_000;
const pendingSchema = z.object({
  provider: z.enum(cliProxySignInProviders),
  url: z.url({ protocol: /^https$/ }),
  state: z.string().min(1).max(256),
  opened: z.boolean(),
  userCode: z.string().optional(),
  started: z.number(),
});
type Pending = z.infer<typeof pendingSchema>;
type State = {
  login: Pending | null;
  accounts: CliProxyAccount[];
  busy: boolean;
  refreshing: boolean;
  error: CliProxyError | "signInFailed" | null;
};

const initialState: State = {
  login: null,
  accounts: [],
  busy: false,
  refreshing: false,
  error: null,
};
let state = initialState;
let popup: Window | null = null;
let refreshInFlight: Promise<void> | undefined;
let pollInFlight = false;
const subscribers = new Set<() => void>();

function patch(changes: Partial<State>) {
  state = { ...state, ...changes };
  for (const notify of subscribers) notify();
}

function subscribe(listener: () => void) {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function useSubscriptionConnections() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => initialState,
  );
}

function setLogin(login: Pending | null) {
  if (login) sessionStorage.setItem(storageKey, JSON.stringify(login));
  else sessionStorage.removeItem(storageKey);
  patch({ login });
}

function readLogin() {
  try {
    const pending = pendingSchema.safeParse(
      JSON.parse(sessionStorage.getItem(storageKey) ?? "null"),
    );
    return pending.success && Date.now() - pending.data.started < expiredAfter
      ? pending.data
      : null;
  } catch {
    return null;
  }
}

async function request<T>(body: object, schema: z.ZodType<T>) {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(110_000),
    });
  } catch {
    throw new Error("proxyOffline");
  }
  if (response.status === 403) throw new Error("proxyUnavailable");
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(data);
    throw new Error(error.success ? error.data.error : "proxyRequestFailed");
  }
  return schema.parse(data);
}

function errorCode(value: unknown) {
  const code = cliProxyErrorSchema.safeParse(value instanceof Error ? value.message : null);
  return code.success ? code.data : "proxyRequestFailed";
}

export function refreshSubscriptionConnections() {
  if (refreshInFlight) return refreshInFlight;
  patch({ refreshing: true });
  refreshInFlight = (async () => {
    try {
      const { accounts, models, modelLabels, modelBrands } = await request(
        { action: "snapshot" },
        cliProxySnapshotSchema,
      );
      await updateProvider("cliproxyapi", {
        models,
        modelLabels,
        modelBrands,
        enabled: models.length > 0,
        apiKey: "",
      });
      patch({ accounts, error: state.error?.startsWith("proxy") ? null : state.error });
    } catch (error) {
      await updateProvider("cliproxyapi", { enabled: false });
      patch({ error: errorCode(error) });
    } finally {
      patch({ refreshing: false });
      refreshInFlight = undefined;
    }
  })();
  return refreshInFlight;
}

async function poll() {
  const { login, busy } = state;
  if (!login || busy || pollInFlight) return;
  if (Date.now() - login.started > expiredAfter) {
    setLogin(null);
    patch({ error: "signInFailed" });
    return;
  }
  pollInFlight = true;
  try {
    const { status } = await request(
      { action: "status", state: login.state },
      cliProxyLoginStatusSchema,
    );
    if (state.login?.state !== login.state || status === "wait") return;
    setLogin(null);
    if (status === "ok") {
      popup = null;
      await refreshInFlight;
      await refreshSubscriptionConnections();
    } else patch({ error: "signInFailed" });
  } catch (error) {
    if (state.login?.state === login.state) patch({ error: errorCode(error) });
  } finally {
    pollInFlight = false;
  }
}

export function subscriptionConnectionsAllowed() {
  return Boolean(desktopBridge()) || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
}

export function monitorSubscriptionConnections() {
  if (!subscriptionConnectionsAllowed()) {
    void updateProvider("cliproxyapi", { enabled: false });
    patch({ error: "proxyUnavailable" });
    return;
  }
  setLogin(readLogin());
  const refresh = () => {
    void refreshSubscriptionConnections();
    void poll();
  };
  refresh();
  window.addEventListener("focus", refresh);
  const recovery = window.setInterval(() => void refreshSubscriptionConnections(), 30_000);
  const signIn = window.setInterval(() => void poll(), 1500);
  return () => {
    window.removeEventListener("focus", refresh);
    window.clearInterval(recovery);
    window.clearInterval(signIn);
  };
}

export async function startSubscriptionLogin(provider: CliProxySignInProvider, accountId?: string) {
  if (state.busy || state.login) return;
  patch({ busy: true, error: null });
  const deviceCode =
    provider === "xai" || provider === "kimi" || provider === "kimi-ai" || provider === "meta";
  popup = desktopBridge() || deviceCode ? null : window.open("about:blank", "_blank");
  try {
    const {
      url,
      opened,
      state,
      user_code: userCode,
    } = await request({ action: "start", provider, accountId }, cliProxyLoginSchema);
    let browserOpened = opened ?? false;
    if (userCode) popup?.close();
    else if (popup && !popup.closed) {
      try {
        popup.opener = null;
        popup.location.href = url;
        browserOpened = true;
      } catch {
        popup.close();
      }
    }
    setLogin({ state, url, provider, opened: browserOpened, userCode, started: Date.now() });
  } catch (error) {
    popup?.close();
    patch({ error: errorCode(error) });
  } finally {
    patch({ busy: false });
  }
}

export async function cancelSubscriptionLogin() {
  const { login, busy } = state;
  if (!login || busy) return;
  patch({ busy: true, error: null });
  try {
    await request({ action: "cancel", state: login.state }, cliProxyLoginStatusSchema);
    popup?.close();
    setLogin(null);
  } catch (error) {
    patch({ error: errorCode(error) });
  } finally {
    patch({ busy: false });
  }
}

export async function disconnectSubscriptionAccount(accountId: string) {
  if (state.busy) return;
  patch({ busy: true, error: null });
  try {
    await request({ action: "disconnect", accountId }, cliProxyLoginStatusSchema);
    await refreshInFlight;
    await refreshSubscriptionConnections();
  } catch (error) {
    patch({ error: errorCode(error) });
  } finally {
    patch({ busy: false });
  }
}
