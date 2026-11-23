import { z } from "zod";

export const cliProxySignInProviders = [
  "codex",
  "claude",
  "antigravity",
  "xai",
  "kimi",
  "kimi-ai",
  "devin",
  "meta",
] as const;
export type CliProxySignInProvider = (typeof cliProxySignInProviders)[number];

export const cliProxyLoginSchema = z.object({
  status: z.literal("ok"),
  url: z.url({ protocol: /^https$/ }),
  state: z.string().min(1).max(256),
  user_code: z.string().trim().min(1).max(128).optional(),
  opened: z.boolean().optional(),
});

export const cliProxyLoginStatusSchema = z.object({
  status: z.enum(["wait", "ok", "error"]),
});

export const cliProxyBrands: Record<CliProxySignInProvider, string> = {
  codex: "ChatGPT",
  claude: "Claude",
  antigravity: "Antigravity",
  xai: "Grok",
  kimi: "Kimi (kimi.com)",
  "kimi-ai": "Kimi (kimi.ai)",
  devin: "Devin",
  meta: "Muse Code",
};

export const cliProxyAccountSchema = z.object({
  id: z.string(),
  provider: z.enum(cliProxySignInProviders),
  email: z.string().optional(),
  status: z.enum(["connected", "reconnect"]),
});

export type CliProxyAccount = z.infer<typeof cliProxyAccountSchema>;

export const cliProxySnapshotSchema = z.object({
  accounts: z.array(cliProxyAccountSchema),
  models: z.array(z.string()),
  modelLabels: z.record(z.string(), z.string()),
  /** The subscription each model comes from, so the model picker can group them. */
  modelBrands: z.record(z.string(), z.enum(cliProxySignInProviders)).default({}),
});

/**
 * A model id as people say it: `claude-opus-5-5` is "Opus 5.5", `gpt-6.2-sol`
 * is "GPT-6.2 Sol". Release dates are dropped, and the subscription's own
 * name, which the picker shows beside it, is left out.
 */
export function subscriptionModelName(id: string): string {
  const words: string[] = [];
  for (const word of id.replace(/[-_]\d{8}$/, "").split(/[-_]/).filter(Boolean)) {
    const previous = words.at(-1);
    if (/^\d+$/.test(word) && previous && /^\d+$/.test(previous)) {
      words[words.length - 1] = `${previous}.${word}`;
    } else {
      words.push(/^gpt$/i.test(word) ? "GPT" : word.charAt(0).toUpperCase() + word.slice(1));
    }
  }
  const name = words.join(" ").replace(/^GPT (\d)/, "GPT-$1");
  return name.replace(/^Claude (?=\D)/, "") || id;
}

export const subscriptionRoute = /^dpl-([0-9a-f]{20})\/(.+)$/;

/**
 * Models a subscription lists but can't chat with. A ChatGPT plan used through
 * Codex refuses the ChatGPT app's own chat models (`gpt-6-chat-thinking`), and
 * `codex-auto-review` only reviews code.
 */
const unusableModels: Partial<Record<CliProxySignInProvider, RegExp>> = {
  codex: /(^|-)chat(-|$)|^codex-auto-review$/i,
};

export function usableSubscriptionModel(provider: CliProxySignInProvider, model: string) {
  return !unusableModels[provider]?.test(model);
}

export const cliProxyErrorSchema = z.enum([
  "proxyUnavailable",
  "proxySetup",
  "proxyOffline",
  "proxyRequestFailed",
  "proxyRateLimited",
  "accountMissing",
]);
export type CliProxyError = z.infer<typeof cliProxyErrorSchema>;
