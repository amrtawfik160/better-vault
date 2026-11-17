import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const desktop = process.argv.includes("--desktop");
const root = fileURLToPath(new URL(desktop ? "../desktop/" : "../", import.meta.url));
const app = spawn(process.execPath, ["run", "start"], {
  cwd: root,
  env: { ...process.env, HOSTNAME: "127.0.0.1" },
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => app.kill(signal));
}
app.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
