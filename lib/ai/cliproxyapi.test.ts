import { afterEach, describe, expect, it } from "vitest";
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
  setDesktopRuntime(false);
  setLoopbackRuntime(false);
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
