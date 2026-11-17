import { z } from "zod";
import { cliProxyError, cliProxyFetch, cliProxyURL } from "@/lib/ai/cliproxyapi";
import {
  cliProxyLoginSchema,
  cliProxyLoginStatusSchema,
  cliProxySignInProviders,
} from "@/lib/ai/cliproxyapi-oauth";
import { describeError } from "@/lib/ai/errors";

const key = z.string().trim().min(1).max(500);
const state = z.string().min(1).max(256);
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), key, provider: z.enum(cliProxySignInProviders) }),
  z.object({ action: z.literal("status"), key, state }),
  z.object({ action: z.literal("cancel"), key, state }),
]);

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { data } = parsed;

  try {
    const base = cliProxyURL({ management: true });
    const routes = { start: "auth-url", status: "status", cancel: "session" };
    const url = new URL(`v8/management/oauth/${routes[data.action]}`, base);
    if (data.action === "start") {
      url.searchParams.set("provider", data.provider);
      url.searchParams.set("is_webui", "true");
    } else {
      url.searchParams.set("state", data.state);
    }
    const response = await cliProxyFetch(url, {
      method: data.action === "cancel" ? "DELETE" : "GET",
      headers: { authorization: `Bearer ${data.key}` },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(cliProxyError(response.status, true));
    }
    const body: unknown = await response.json().catch(() => null);
    const result =
      data.action === "start"
        ? cliProxyLoginSchema.safeParse(body)
        : cliProxyLoginStatusSchema.safeParse(body);
    if (!result.success) throw new Error("CLIProxyAPI returned an invalid sign-in response.");
    return Response.json(result.data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: describeError(error) }, { status: 502 });
  }
}
