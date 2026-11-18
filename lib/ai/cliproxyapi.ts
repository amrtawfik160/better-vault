import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { wrapLanguageModel } from "ai";
import { z } from "zod";
import type { ProviderId } from "./catalog";
import { imageInputErrorStatuses, rejectsImageInput } from "./errors";
import { isLocalAppRequest, isLoopbackHost, localProvidersAllowed } from "./server-config";

import { subscriptionRoute } from "./cliproxyapi-oauth";
import { cliProxyConnection, ensureCliProxy, usesManagedCliProxy } from "./cliproxyapi-runtime";

export function rejectCliProxyRequest(request: Request, provider: ProviderId = "cliproxyapi") {
  if (provider !== "cliproxyapi") return;

  const json = request.headers.get("content-type")?.split(";")[0].trim() === "application/json";
  if (json && isLocalAppRequest(request)) return;

  return Response.json(
    { error: "AI subscription connections are available on this computer only." },
    { status: 403 },
  );
}

export function cliProxyKey(kind: "client" | "management"): string {
  const key = cliProxyConnection()[kind];
  if (!key?.trim()) throw new Error("proxySetup");
  return key.trim();
}

export function cliProxyURL({ management = false } = {}): URL {
  if (!localProvidersAllowed()) throw new Error("CLIProxyAPI is turned off on this server.");

  // Only the person running better-vault can choose where requests and keys go.
  const url = URL.parse(cliProxyConnection().url.trim());
  if (!url || url.username || url.password || url.search || url.hash) {
    throw new Error("Set BETTER_VAULT_CLIPROXYAPI_URL to the CLIProxyAPI server address.");
  }
  const loopback = isLoopbackHost(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("Use HTTPS for a CLIProxyAPI server on another machine.");
  }
  if (management && !loopback) {
    throw new Error("For a remote CLIProxyAPI server, sign in on the proxy itself.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "") + "/";
  return url;
}

export const cliProxyFetch: typeof fetch = async (input, init) => {
  try {
    return await fetch(input, { ...init, cache: "no-store", redirect: "error" });
  } catch {
    if (init?.signal?.aborted) throw init.signal.reason;
    throw new Error("proxyOffline");
  }
};

export function cliProxyError(status: number, management = false): string {
  if (status === 401 || status === 403) {
    return "The local subscription proxy could not authenticate Better Vault.";
  }
  if (management && status === 404) {
    return "Start Better Vault with its local subscription proxy to connect accounts.";
  }
  if (status === 429) return "CLIProxyAPI or the selected provider is rate limited.";
  return `CLIProxyAPI returned HTTP ${status}. Check the proxy logs for details.`;
}

const modelListSchema = z.object({
  data: z.array(z.object({ id: z.string().trim().min(1).max(200) })),
});

const nonTextModel =
  /(^|[-_/])(image|realtime|tts|transcribe|audio|embeddings?|moderation|whisper|dall-e|imagen|veo|computer-use)(?=$|[-_/])/i;

export async function listRawCliProxyModels(): Promise<string[]> {
  const response = await cliProxyFetch(new URL("v1/models", cliProxyURL()), {
    headers: { authorization: `Bearer ${cliProxyKey("client")}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(cliProxyError(response.status));
  }

  const list = modelListSchema.safeParse(await response.json().catch(() => null));
  if (!list.success) throw new Error("CLIProxyAPI returned an invalid model list.");
  return [...new Set(list.data.data.map(({ id }) => id).filter((id) => !nonTextModel.test(id)))];
}

export async function cliProxyLanguageModel(modelId: string) {
  await ensureCliProxy();
  if (cliProxyConnection().management && !subscriptionRoute.test(modelId)) {
    const { proxyCredentials } = await import("./cliproxyapi-accounts");
    if (usesManagedCliProxy() || (await proxyCredentials()).length > 0)
      throw new Error("Choose a model from a connected AI subscription.");
  }
  const proxy = createOpenAICompatible({
    name: "cliproxyapi",
    baseURL: new URL("v1", cliProxyURL()).href,
    apiKey: cliProxyKey("client"),
    includeUsage: true,
    fetch: async (input, init) => {
      const response = await cliProxyFetch(input, init);
      if (response.ok) return response;
      let message = cliProxyError(response.status);
      if (imageInputErrorStatuses.includes(response.status)) {
        const detail = await response.text().catch(() => "");
        if (rejectsImageInput(detail)) message = "The selected model does not support image input.";
      } else {
        await response.body?.cancel();
      }
      return Response.json({ error: { message } }, { status: response.status });
    },
  });

  return wrapLanguageModel({
    model: proxy.chatModel(modelId),
    middleware: {
      // The proxy routes to different APIs. Give Studio models the schema in their prompt
      // even when the upstream doesn't implement Chat Completions' response_format.
      transformParams: async ({ params }) => {
        if (params.responseFormat?.type !== "json") return params;
        const schema = params.responseFormat.schema;
        const instruction =
          "Reply with only valid JSON. Omit markdown fences and explanatory text." +
          (schema ? ` The JSON must match this schema:\n${JSON.stringify(schema)}` : "");
        const [first, ...rest] = params.prompt;
        const prompt =
          first?.role === "system"
            ? [{ ...first, content: `${first.content}\n\n${instruction}` }, ...rest]
            : [{ role: "system" as const, content: instruction }, ...params.prompt];
        return { ...params, prompt, responseFormat: undefined };
      },
    },
  });
}
