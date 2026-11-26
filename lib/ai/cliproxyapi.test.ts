import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/server/routes/cliproxyapi";
import { cliProxyRequestError, rejectCliProxyRequest } from "./cliproxyapi";
import { subscriptionModelName, usableSubscriptionModel } from "./cliproxyapi-oauth";
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

describe("subscription models", () => {
  it("hides models a ChatGPT plan can't chat with", () => {
    expect(usableSubscriptionModel("codex", "gpt-6-chat-thinking")).toBe(false);
    expect(usableSubscriptionModel("codex", "codex-auto-review")).toBe(false);
    expect(usableSubscriptionModel("codex", "gpt-6.2-sol")).toBe(true);
    expect(usableSubscriptionModel("claude", "claude-chat-thing")).toBe(true);
  });

  it("explains why a subscription request failed", () => {
    const refused = JSON.stringify({
      error: {
        message:
          "auth_unavailable: no auth available (last upstream error: model_not_found: The 'x' model is not supported when using Codex with a ChatGPT account.)",
      },
    });
    expect(cliProxyRequestError(503, refused)).toMatch(/isn't available on your subscription/);
    expect(cliProxyRequestError(429, "")).toMatch(/usage limit/);
    expect(cliProxyRequestError(503, JSON.stringify({ error: { message: "no auth available" } }))).toMatch(
      /Reconnect it/,
    );
    expect(cliProxyRequestError(500, JSON.stringify({ error: { message: "Upstream broke" } }))).toBe(
      "Upstream broke",
    );
    expect(cliProxyRequestError(502, "not json")).toMatch(/HTTP 502/);
  });
});

describe("subscription model names", () => {
  it("names models as people say them", () => {
    expect(subscriptionModelName("claude-opus-5-5")).toBe("Opus 5.5");
    expect(subscriptionModelName("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
    expect(subscriptionModelName("claude-3-7-sonnet-20250219")).toBe("Claude 3.7 Sonnet");
    expect(subscriptionModelName("gpt-6.2-sol")).toBe("GPT-6.2 Sol");
    expect(subscriptionModelName("gemini-3.8-flash")).toBe("Gemini 3.8 Flash");
  });
});

describe("jsonFromReply", () => {
  it("keeps the JSON from a fenced or chatty reply", async () => {
    const { jsonFromReply } = await import("./cliproxyapi");
    expect(jsonFromReply('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(jsonFromReply('Here is the quiz:\n{"questions":[1,2]}\nHope it helps.')).toBe('{"questions":[1,2]}');
    expect(jsonFromReply("[1, 2]")).toBe("[1, 2]");
    expect(jsonFromReply("no json here")).toBe("no json here");
  });
});
