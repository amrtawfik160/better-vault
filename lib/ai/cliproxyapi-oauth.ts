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
});

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
