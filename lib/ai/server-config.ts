/**
 * Server-side switches, set with environment variables when hosting
 * better-vault for others.
 *
 * BETTER_VAULT_ALLOW_LOCAL_PROVIDERS=false turns off Ollama, LM Studio and
 * CLIProxyAPI. Ollama and LM Studio accept addresses supplied by the user.
 */
export function localProvidersAllowed(): boolean {
  return process.env.BETTER_VAULT_ALLOW_LOCAL_PROVIDERS !== "false";
}

let desktopRuntime = false;
let loopbackRuntime = false;

export function isLoopbackHost(host: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
}

/** A web server must listen only on loopback to use its own proxy credentials. */
export function setLoopbackRuntime(loopback: boolean) {
  loopbackRuntime = loopback;
}

export function isLoopbackRuntime(): boolean {
  return loopbackRuntime;
}

/** Set by `createApi({ desktop: true })` when the API runs inside the desktop app. */
export function setDesktopRuntime(desktop: boolean) {
  desktopRuntime = desktop;
}

/** True when the API runs inside the desktop app's main process. */
export function isDesktopRuntime(): boolean {
  return desktopRuntime;
}

/**
 * Sign in with ChatGPT works in the desktop app only. Its tokens are kept by
 * the server, so on a web server, even one on your own computer, they would
 * belong to whoever reaches it; OpenAI also offers it only to apps that run
 * locally. BETTER_VAULT_ALLOW_CHATGPT=false turns it off in the desktop app too.
 */
export function chatGPTAllowed(): boolean {
  return desktopRuntime && process.env.BETTER_VAULT_ALLOW_CHATGPT !== "false";
}

/** Checks a local provider address: http(s) only. */
export function parseBaseURL(value: string | undefined, fallback: string): URL {
  const url = new URL(value?.trim() || fallback);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The server address must start with http:// or https://.");
  }
  return url;
}
