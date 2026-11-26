import { ProviderIcon } from "@/components/provider-icon";
import type { CliProxySignInProvider } from "@/lib/ai/cliproxyapi-oauth";

const brands: Record<CliProxySignInProvider, { logo?: string; darkLogo?: string }> = {
  codex: {},
  claude: { logo: "claude" },
  antigravity: { logo: "antigravity" },
  xai: { logo: "grok", darkLogo: "grok-dark" },
  kimi: { logo: "kimi-light", darkLogo: "kimi-dark" },
  "kimi-ai": {
    logo: "kimi-light",
    darkLogo: "kimi-dark",
  },
  devin: { logo: "devin", darkLogo: "devin-dark" },
  meta: { logo: "meta" },
};

/** A subscription's mark, with its dark-mode twin where it has one. */
export function SubscriptionLogo({
  provider,
  size = 20,
}: {
  provider: CliProxySignInProvider;
  size?: number;
}) {
  const { logo, darkLogo } = brands[provider];
  if (!logo) return <ProviderIcon provider="openai" size={size} />;
  return (
    <>
      <img
        style={{ width: size, height: size }}
        src={`/providers/subscriptions/${logo}.svg`}
        alt=""
        width={size}
        height={size}
        className={
          darkLogo ? "shrink-0 object-contain dark:hidden" : "shrink-0 object-contain"
        }
      />
      {darkLogo ? (
        <img
          style={{ width: size, height: size }}
          src={`/providers/subscriptions/${darkLogo}.svg`}
          alt=""
          width={size}
          height={size}
          className="hidden shrink-0 object-contain dark:block"
        />
      ) : null}
    </>
  );
}
