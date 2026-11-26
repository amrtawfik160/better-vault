import { z } from "zod";
import { cliProxyKey, listRawCliProxyModels, rejectCliProxyRequest } from "@/lib/ai/cliproxyapi";
import { proxyCredentials, proxyManagement, proxySnapshot } from "@/lib/ai/cliproxyapi-accounts";
import {
  cliProxyErrorSchema,
  cliProxyLoginSchema,
  cliProxyLoginStatusSchema,
  cliProxySignInProviders,
} from "@/lib/ai/cliproxyapi-oauth";
import { cliProxyConnection, ensureCliProxy } from "@/lib/ai/cliproxyapi-runtime";

const state = z.string().min(1).max(256);
const accountId = z.string().regex(/^[0-9a-f]{20}$/);
const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    provider: z.enum(cliProxySignInProviders),
    accountId: accountId.optional(),
  }),
  z.object({ action: z.literal("status"), state }),
  z.object({ action: z.literal("cancel"), state }),
  z.object({ action: z.literal("snapshot") }),
  z.object({ action: z.literal("disconnect"), accountId }),
]);

export async function POST(request: Request, openSignIn?: (url: string) => Promise<void>) {
  const denied = rejectCliProxyRequest(request);
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "proxyRequestFailed" }, { status: 400 });
  const { data } = parsed;
  const headers = { "cache-control": "no-store" };
  const signal = request.signal;

  try {
    await ensureCliProxy();
    if (data.action === "snapshot") {
      const snapshot = cliProxyConnection().management
        ? await proxySnapshot()
        : { models: await listRawCliProxyModels(), accounts: [], modelLabels: {}, modelBrands: {} };
      return Response.json(snapshot, { headers });
    }

    if (data.action === "disconnect") {
      const entry = (await proxyCredentials()).find(({ account }) => account.id === data.accountId);
      if (!entry) throw new Error("accountMissing");
      await proxyManagement("credentials", {
        method: "DELETE",
        query: { name: entry.name },
        signal,
      });
      return Response.json({ status: "ok" }, { headers });
    }

    if (data.action === "start") {
      cliProxyKey("client");
      const query: Record<string, string> = { provider: data.provider, is_webui: "true" };
      if (data.accountId) {
        const entry = (await proxyCredentials()).find(
          ({ account }) => account.id === data.accountId && account.provider === data.provider,
        );
        if (!entry) throw new Error("accountMissing");
        query.auth_index = entry.authIndex;
      }
      const result = cliProxyLoginSchema.parse(
        await proxyManagement("oauth/auth-url", { query, signal }),
      );
      const opened =
        openSignIn && !result.user_code
          ? await openSignIn(result.url).then(
              () => true,
              () => false,
            )
          : false;
      return Response.json({ ...result, opened }, { headers });
    }

    const query = { state: data.state };
    const body =
      data.action === "cancel"
        ? await proxyManagement("oauth/session", { method: "DELETE", query, signal })
        : await proxyManagement("oauth/status", { query, signal });
    return Response.json(cliProxyLoginStatusSchema.parse(body), { headers });
  } catch (error) {
    const code = cliProxyErrorSchema.safeParse(error instanceof Error ? error.message : null);
    return Response.json(
      { error: code.success ? code.data : "proxyRequestFailed" },
      { status: 502, headers },
    );
  }
}
