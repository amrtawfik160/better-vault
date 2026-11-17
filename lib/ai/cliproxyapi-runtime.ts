import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parse, stringify } from "yaml";
import { installCliProxy, proxyExecutable } from "./cliproxyapi-install.mjs";
import { isDesktopRuntime, isLoopbackRuntime, localProvidersAllowed } from "./server-config";

const env = process.env;
const prefix = "BETTER_VAULT_CLIPROXYAPI_";
const defaultAddress = "http://127.0.0.1:8317";

type Connection = { url: string; client: string; management: string };
type Runtime = {
  child?: ChildProcess;
  connection?: Connection;
  starting?: Promise<Connection>;
  generation?: number;
};
const shared = globalThis as typeof globalThis & { deepLeCliProxyRuntime?: Runtime };
const runtime = (shared.deepLeCliProxyRuntime ??= {});

export function usesManagedCliProxy(): boolean {
  return !env[prefix + "URL"] && !env[prefix + "CLIENT_KEY"] && !env[prefix + "MANAGEMENT_KEY"];
}

export function cliProxyConnection(): Connection {
  if (!usesManagedCliProxy()) {
    return {
      url: env[prefix + "URL"] || defaultAddress,
      client: env[prefix + "CLIENT_KEY"]?.trim() || "",
      management: env[prefix + "MANAGEMENT_KEY"]?.trim() || "",
    };
  }
  return runtime.connection ?? { url: defaultAddress, client: "", management: "" };
}

async function readOrCreate(path: string, content: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // A hard link publishes the complete private file without replacing another instance's file.
  const temp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temp, content, { flag: "wx", mode: 0o600 });
  try {
    await link(temp, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    await unlink(temp);
  }
  return readFile(path, "utf8");
}

async function healthy(connection: Connection) {
  try {
    const result = await fetch(new URL("/v8/management/credentials", connection.url), {
      headers: { authorization: `Bearer ${connection.management}` },
      signal: AbortSignal.timeout(1000),
      redirect: "error",
    });
    await result.body?.cancel();
    return result.ok;
  } catch {
    return false;
  }
}

async function startManagedProxy(): Promise<Connection> {
  const generation = runtime.generation;
  const home = resolve(env[prefix + "HOME"] || join(homedir(), ".better-vault", "cliproxyapi"));
  await mkdir(home, { recursive: true, mode: 0o700 });
  const [, client, , , management] = (
    await readOrCreate(
      join(home, "keys.txt"),
      `Proxy client API key\n${randomBytes(24).toString("hex")}\n\nProxy management key\n${randomBytes(24).toString("hex")}\n`,
    )
  ).split(/\r?\n/);
  if (!client || !management) throw new Error("proxySetup");

  const configPath = join(home, "config.yaml");
  const config = parse(
    await readOrCreate(
      configPath,
      stringify({
        "config-version": 8,
        server: { host: "127.0.0.1", port: Number(env[prefix + "PORT"]) || 8317 },
        access: { "api-keys": [client] },
        management: {
          "allow-remote": false,
          "secret-key": management,
          "disable-control-panel": true,
        },
        oauth: { "auth-dir": join(home, "auth") },
      }),
    ),
  );
  const port = config?.server?.port;
  if (
    config?.server?.host !== "127.0.0.1" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    config?.management?.["allow-remote"] === true ||
    !config?.access?.["api-keys"]?.includes(client)
  )
    throw new Error("proxySetup");

  const connection = { url: `http://127.0.0.1:${port}`, client, management };
  if (await healthy(connection)) return connection;
  const resources =
    isDesktopRuntime() && (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const bundled = resources && join(resources, "cliproxyapi", proxyExecutable());
  const override = env[prefix + "BIN"];
  const binary = override
    ? isAbsolute(override) || !override.includes("/")
      ? override
      : resolve(override)
    : bundled &&
        (await access(bundled).then(
          () => true,
          () => false,
        ))
      ? bundled
      : await installCliProxy(join(home, "bin")).catch(() => {
          throw new Error("proxySetup");
        });

  if (generation !== runtime.generation) throw new Error("proxyOffline");
  const child = spawn(binary, ["--config", configPath], {
    cwd: home,
    stdio: "ignore",
    windowsHide: true,
  });
  runtime.child = child;
  let exited = false;
  function clearChild() {
    exited = true;
    if (runtime.child === child) {
      runtime.child = undefined;
      runtime.connection = undefined;
    }
  }
  child.once("exit", clearChild);
  child.once("error", clearChild);

  for (let attempt = 0; attempt < 40; attempt++) {
    if (await healthy(connection)) {
      if (exited) runtime.child = undefined;
      return connection;
    }
    if (exited && attempt >= 4) break;
    await delay(225);
  }
  if (!exited) child.kill();
  throw new Error("proxyOffline");
}

export async function ensureCliProxy() {
  if (!localProvidersAllowed() || !(isDesktopRuntime() || isLoopbackRuntime())) {
    throw new Error("proxyUnavailable");
  }
  const current = cliProxyConnection();
  if (!usesManagedCliProxy()) return;
  if (runtime.child && current.client && current.management) return;

  runtime.starting ??= startManagedProxy().finally(() => {
    runtime.starting = undefined;
  });
  runtime.connection = await runtime.starting;
}

export function stopCliProxy() {
  runtime.generation = (runtime.generation ?? 0) + 1;
  runtime.child?.kill();
}
