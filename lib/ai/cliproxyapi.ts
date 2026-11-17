import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { wrapLanguageModel } from "ai";
import { z } from "zod";
import { localProvidersAllowed } from "./server-config";

const defaultAddress = "http://127.0.0.1:8317";
const loopbackHosts = ["127.0.0.1", "[::1]", "localhost"];

export function cliProxyURL({ management = false } = {}): URL {
  if (!localProvidersAllowed()) throw new Error("CLIProxyAPI is turned off on this server.");

  // Only the person running better-vault can choose where requests and keys go.
  const url = URL.parse(process.env.BETTER_VAULT_CLIPROXYAPI_URL?.trim() || defaultAddress);
  if (!url || url.username || url.password || url.search || url.hash) {
    throw new Error("Set BETTER_VAULT_CLIPROXYAPI_URL to the CLIProxyAPI server address.");
  }
  const loopback = loopbackHosts.includes(url.hostname);
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
    throw new Error("Could not reach CLIProxyAPI. Check that the proxy is running.");
  }
};

export function cliProxyError(status: number, management = false): string {
  if (status === 401 || status === 403) {
    const key = management ? "management key" : "client API key";
    return `CLIProxyAPI rejected the ${key} (HTTP ${status}).`;
  }
  if (management && status === 404) {
    return "Check that CLIProxyAPI v8 is running with a management key configured.";
  }
  if (status === 429) return "CLIProxyAPI or the selected provider is rate limited.";
  return `CLIProxyAPI returned HTTP ${status}. Check the proxy logs for details.`;
}

const modelListSchema = z.object({
  data: z.array(z.object({ id: z.string().trim().min(1).max(200) })),
});

const nonTextModel =
  /(^|[-_/])(image|realtime|tts|transcribe|audio|embeddings?|moderation|whisper|dall-e|imagen|veo|computer-use)(?=$|[-_/])/i;

export async function listCliProxyModels(apiKey: string | undefined): Promise<string[]> {
  const response = await cliProxyFetch(new URL("v1/models", cliProxyURL()), {
    headers: { authorization: `Bearer ${apiKey}` },
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

export function cliProxyLanguageModel(modelId: string, apiKey: string | undefined) {
  const proxy = createOpenAICompatible({
    name: "cliproxyapi",
    baseURL: new URL("v1", cliProxyURL()).href,
    apiKey,
    includeUsage: true,
    fetch: async (input, init) => {
      const response = await cliProxyFetch(input, init);
      if (response.ok) return response;
      await response.body?.cancel();
      return Response.json(
        { error: { message: cliProxyError(response.status) } },
        { status: response.status },
      );
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
