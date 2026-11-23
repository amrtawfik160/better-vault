import { usesManagedCliProxy } from "./cliproxyapi-runtime";
import { createHash } from "node:crypto";
import { z } from "zod";
import { cliProxyFetch, cliProxyKey, cliProxyURL, listRawCliProxyModels } from "./cliproxyapi";
import {
  cliProxyBrands,
  cliProxySignInProviders,
  subscriptionRoute,
  usableSubscriptionModel,
  type CliProxyAccount,
} from "./cliproxyapi-oauth";

const providerSchema = z.enum(cliProxySignInProviders);
const credentialSchema = z.object({
  name: z
    .string()
    .regex(/^[^/\\]+\.json$/i)
    .max(512),
  auth_index: z.string().min(1),
  provider: z.string(),
  oauth_provider: z.string().optional(),
  runtime_only: z.boolean().optional(),
  disabled: z.boolean().optional(),
  unavailable: z.boolean().optional(),
  status: z.string().optional(),
  email: z.email().max(254).optional().catch(undefined),
});

export async function proxyManagement(
  path: string,
  {
    query,
    body,
    method = "GET",
    signal,
  }: {
    query?: Record<string, string>;
    body?: object;
    method?: string;
    signal?: AbortSignal;
  } = {},
): Promise<unknown> {
  const url = new URL(`v8/management/${path}`, cliProxyURL({ management: true }));
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  const response = await cliProxyFetch(url, {
    method,
    headers: {
      authorization: `Bearer ${cliProxyKey("management")}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
      : AbortSignal.timeout(10_000),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 429) throw new Error("proxyRateLimited");
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new Error("proxySetup");
    }
    throw new Error("proxyRequestFailed");
  }
  return data;
}

export async function proxyCredentials() {
  const credentials = z
    .object({ files: z.array(z.unknown()) })
    .parse(await proxyManagement("credentials"));
  return credentials.files.flatMap((entry) => {
    const parsed = credentialSchema.safeParse(entry);
    if (!parsed.success || parsed.data.runtime_only) return [];
    const file = parsed.data;
    const provider = providerSchema.safeParse(file.oauth_provider || file.provider);
    if (!provider.success) return [];
    const id = createHash("sha256").update(file.name).digest("hex").slice(0, 20);
    const account: CliProxyAccount = {
      id,
      provider: provider.data,
      email: file.email,
      status:
        file.disabled ||
        file.status === "disabled" ||
        file.status === "error" ||
        file.status === "expired" ||
        file.unavailable
          ? "reconnect"
          : "connected",
    };
    return [{ account, name: file.name, authIndex: file.auth_index, prefix: `dpl-${id}` }];
  });
}

let reconciling: ReturnType<typeof readSnapshot> | undefined;

async function readSnapshot() {
  const entries = await proxyCredentials();
  // Prefixes must be registered on the credential before we expose the route. CLIProxyAPI
  // otherwise pools identically named models across providers and accounts.
  await Promise.all(
    entries
      .filter(({ account }) => account.status === "connected")
      .map(async (entry) => {
        const query = { name: entry.name };
        const list = z
          .object({ models: z.array(z.object({ id: z.string() })) })
          .parse(await proxyManagement("credentials/models", { query }));
        if (list.models.some(({ id }) => id.startsWith(entry.prefix + "/"))) return;
        await proxyManagement("credentials/fields", {
          method: "PATCH",
          body: { name: entry.name, prefix: entry.prefix },
        });
      }),
  );
  const registered = await listRawCliProxyModels();
  const accounts = entries.map(({ account }) => account);
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const modelLabels: Record<string, string> = {};
  const models = registered.filter((registeredId) => {
    if (entries.length === 0)
      return !usesManagedCliProxy() && !subscriptionRoute.test(registeredId);
    const match = subscriptionRoute.exec(registeredId);
    const account = match && byId.get(match[1]);
    if (!account || account.status !== "connected") return false;
    if (!usableSubscriptionModel(account.provider, match[2])) return false;
    const peers = accounts.filter(({ provider }) => provider === account.provider);
    const suffix = peers.length > 1 ? ` · ${account.email ?? peers.indexOf(account) + 1}` : "";
    modelLabels[registeredId] = `${cliProxyBrands[account.provider]} · ${match[2]}${suffix}`;
    return true;
  });
  return { accounts, models, modelLabels };
}

export function proxySnapshot() {
  reconciling ??= readSnapshot().finally(() => {
    reconciling = undefined;
  });
  return reconciling;
}
