import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = resolve(
  process.env.BETTER_VAULT_CLIPROXYAPI_HOME ?? join(homedir(), ".better-vault", "cliproxyapi"),
);
const config = join(directory, "config.yaml");
const keyFile = join(directory, "keys.txt");
const desktop = process.argv.includes("--desktop");
const appDirectory = desktop ? join(root, "desktop") : root;
const appFile = desktop
  ? join(appDirectory, "out", "main", "main.js")
  : join(root, "dist", "server", "node.js");
const port = "8317";

await access(appFile).catch(() => {
  throw new Error(
    `Run bun run build in ${appDirectory} before starting Better Vault with subscriptions.`,
  );
});
await mkdir(directory, { recursive: true, mode: 0o700 });

async function createOnce(path, content) {
  try {
    await writeFile(path, content, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
}

const keyExists = await access(keyFile).then(
  () => true,
  () => false,
);
if (!keyExists) {
  const configExists = await access(config).then(
    () => true,
    () => false,
  );
  if (configExists)
    throw new Error("The subscription proxy directory is missing its local credentials.");
  await createOnce(
    keyFile,
    `Proxy client API key\n${randomBytes(24).toString("hex")}\n\nProxy management key\n${randomBytes(24).toString("hex")}\n`,
  );
}
const [, clientKey, , , managementKey] = (await readFile(keyFile, "utf8")).split(/\r?\n/);
if (!clientKey || !managementKey)
  throw new Error("The subscription proxy credentials could not be read.");
await createOnce(
  config,
  `config-version: 8
server:
  host: "127.0.0.1"
  port: ${port}
access:
  api-keys:
    - ${JSON.stringify(clientKey)}
management:
  allow-remote: false
  secret-key: ${JSON.stringify(managementKey)}
  disable-control-panel: true
oauth:
  auth-dir: ${JSON.stringify(join(directory, "auth"))}
`,
);

const proxyBinary = process.env.BETTER_VAULT_CLIPROXYAPI_BIN || "cliproxyapi";
const proxy = spawn(proxyBinary, ["--config", config], {
  cwd: directory,
  stdio: "inherit",
});
const appArgs = desktop
  ? [join(appDirectory, "node_modules", "electron", "cli.js"), "."]
  : [appFile];
const app = spawn(process.execPath, appArgs, {
  cwd: appDirectory,
  env: {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    BETTER_VAULT_CLIPROXYAPI_URL: `http://127.0.0.1:${port}`,
    BETTER_VAULT_CLIPROXYAPI_CLIENT_KEY: clientKey,
    BETTER_VAULT_CLIPROXYAPI_MANAGEMENT_KEY: managementKey,
  },
  stdio: "inherit",
});

function stop() {
  proxy.kill();
  app.kill();
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
function exitCode(child, name) {
  return new Promise((resolveExit) => {
    child.once("error", (error) => {
      console.error(`Could not start ${name}: ${error.message}`);
      resolveExit(1);
    });
    child.once("exit", (code) => resolveExit(code ?? 0));
  });
}

process.exitCode = await Promise.race([
  exitCode(proxy, proxyBinary),
  exitCode(app, "Better Vault"),
]);
stop();
