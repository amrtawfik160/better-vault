import { z } from "zod";
import {
  cliProxyError,
  cliProxyFetch,
  cliProxyKey,
  cliProxyURL,
  rejectCliProxyRequest,
} from "@/lib/ai/cliproxyapi";
import {
  cliProxyLoginSchema,
  cliProxyLoginStatusSchema,
  cliProxySignInProviders,
} from "@/lib/ai/cliproxyapi-oauth";
import { describeError } from "@/lib/ai/errors";

const state = z.string().min(1).max(256);
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), provider: z.enum(cliProxySignInProviders) }),
  z.object({ action: z.literal("status"), state }),
  z.object({ action: z.literal("cancel"), state }),
]);

export async function POST(request: Request, openSignIn?: (url: string) => Promise<void>) {
  const denied = rejectCliProxyRequest(request);
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { data } = parsed;

  try {
    const base = cliProxyURL({ management: true });
    const routes = { start: "auth-url", status: "status", cancel: "session" };
    const url = new URL(`v8/management/oauth/${routes[data.action]}`, base);
    if (data.action === "start") {
      cliProxyKey("client");
      url.searchParams.set("provider", data.provider);
      url.searchParams.set("is_webui", "true");
    } else {
      url.searchParams.set("state", data.state);
    }
    const response = await cliProxyFetch(url, {
      method: data.action === "cancel" ? "DELETE" : "GET",
      headers: { authorization: `Bearer ${cliProxyKey("management")}` },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(cliProxyError(response.status, true));
    }
    const body: unknown = await response.json().catch(() => null);
    const headers = { "cache-control": "no-store" };
    if (data.action === "start") {
      const result = cliProxyLoginSchema.safeParse(body);
      if (!result.success) throw new Error("CLIProxyAPI returned an invalid sign-in response.");
      const opened =
        openSignIn && !result.data.user_code
          ? await openSignIn(result.data.url).then(
              () => true,
              () => false,
            )
          : false;
      return Response.json({ ...result.data, opened }, { headers });
    }

    const result = cliProxyLoginStatusSchema.safeParse(body);
    if (!result.success) throw new Error("CLIProxyAPI returned an invalid sign-in response.");
    return Response.json(result.data, { headers });
  } catch (error) {
    return Response.json({ error: describeError(error) }, { status: 502 });
  }
}
