import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/server/routes/cliproxyapi";
import { rejectCliProxyRequest } from "./cliproxyapi";
import { setDesktopRuntime, setLoopbackRuntime } from "./server-config";

function request(origin?: string, address = "http://127.0.0.1:3000") {
  return new Request(`${address}/api/cliproxyapi/oauth`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setDesktopRuntime(false);
  setLoopbackRuntime(false);
});

describe("subscription sign-in handoff", () => {
  function signIn(provider: string, upstream: object) {
    setDesktopRuntime(true);
    vi.stubEnv("BETTER_VAULT_ALLOW_LOCAL_PROVIDERS", "true");
    vi.stubEnv("BETTER_VAULT_CLIPROXYAPI_URL", "http://127.0.0.1:8317");
    vi.stubEnv("BETTER_VAULT_CLIPROXYAPI_CLIENT_KEY", "test-client-key");
    vi.stubEnv("BETTER_VAULT_CLIPROXYAPI_MANAGEMENT_KEY", "test-management-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(upstream)));
    return new Request("app://better-vault/api/cliproxyapi/oauth", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "app://better-vault" },
      body: JSON.stringify({ action: "start", provider }),
    });
  }

  it("returns the one-time code before opening the provider's page", async () => {
    const upstream = {
      status: "ok",
      state: "xai-fixture",
      url: "https://accounts.x.ai/device",
      user_code: "ABCD-1234",
    };
    const open = vi.fn().mockResolvedValue(undefined);
    const response = await POST(signIn("xai", upstream), open);
    expect(await response.json()).toEqual({ ...upstream, opened: false });
    expect(open).not.toHaveBeenCalled();
  });

  it("opens browser-based sign-in automatically on desktop", async () => {
    const upstream = {
      status: "ok",
      state: "devin-fixture",
      url: "https://app.devin.ai/auth/authorize",
    };
    const open = vi.fn().mockResolvedValue(undefined);
    const response = await POST(signIn("devin", upstream), open);
    expect(await response.json()).toEqual({ ...upstream, opened: true });
    expect(open).toHaveBeenCalledWith(upstream.url);
  });
});

describe("managed subscription access", () => {
  it("accepts the app's loopback web origin", () => {
    setLoopbackRuntime(true);
    expect(rejectCliProxyRequest(request("http://127.0.0.1:3000"))).toBeUndefined();
  });

  it("rejects cross-origin requests, including a different loopback port", () => {
    setLoopbackRuntime(true);
    expect(rejectCliProxyRequest(request("https://example.com"))?.status).toBe(403);
    expect(rejectCliProxyRequest(request("http://127.0.0.1:3001"))?.status).toBe(403);
  });

  it("rejects requests to a publicly bound app even with a loopback Host header", () => {
    expect(rejectCliProxyRequest(request("http://127.0.0.1:3000"))?.status).toBe(403);
    expect(rejectCliProxyRequest(request(), "openai")).toBeUndefined();
  });

  it("accepts the desktop app's own protocol origin", () => {
    setDesktopRuntime(true);
    expect(
      rejectCliProxyRequest(request("app://better-vault", "app://better-vault")),
    ).toBeUndefined();
    expect(
      rejectCliProxyRequest(request("https://example.com", "app://better-vault"))?.status,
    ).toBe(403);
  });
});
