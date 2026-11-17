import { z } from "zod";

export const cliProxySignInProviders = ["codex", "claude", "antigravity"] as const;
export type CliProxySignInProvider = (typeof cliProxySignInProviders)[number];

export const cliProxyLoginSchema = z.object({
  status: z.literal("ok"),
  url: z.url({ protocol: /^https$/ }),
  state: z.string().min(1).max(256),
  opened: z.boolean().optional(),
});

export const cliProxyLoginStatusSchema = z.object({
  status: z.enum(["wait", "ok", "error"]),
});
