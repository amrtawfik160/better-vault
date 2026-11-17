import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export const proxyVersion = "8.0.67";
const checksums = {
  "darwin-arm64": "ea5bc14e874f422b0049ada5bcc0552636340fab0fac791d7dda6af4fe70fccf",
  "darwin-x64": "ca0600e743748afd6103d1fc57be93b59b211fa88d9215e1ff3462ab58ad4214",
  "linux-arm64": "716744c8e41762e4621eea841138be908c0ffbe373a31d5674331def8d700ad7",
  "linux-x64": "5edaf5180be7d1aa31a0aaae0fc115d715b43001b7572c69709ed155f3a7d876",
  "win32-x64": "7863ad44d3b75c7c4af7bcae3d87e28c9bb2985a47295dba6d110e33c9e51077",
};

export function proxyExecutable(platform = process.platform) {
  return platform === "win32" ? "cli-proxy-api.exe" : "cli-proxy-api";
}

export async function installCliProxy(root, platform = process.platform, arch = process.arch) {
  const target = `${platform}-${arch}`;
  const checksum = checksums[target];
  if (!checksum) throw new Error(`Subscriptions are unavailable on ${target}.`);
  const installPath = join(root, `${proxyVersion}-${target}`);
  const executable = proxyExecutable(platform);
  const binary = join(installPath, executable);
  if (
    await access(binary).then(
      () => true,
      () => false,
    )
  )
    return binary;

  await mkdir(root, { recursive: true, mode: 0o700 });
  const temp = await mkdtemp(join(root, "install-"));
  try {
    const windows = platform === "win32";
    const releasePlatform = windows ? "windows" : platform;
    const releaseArch = arch === "arm64" ? "aarch64" : "amd64";
    const archiveName = `CLIProxyAPI_${proxyVersion}_${releasePlatform}_${releaseArch}.${windows ? "zip" : "tar.gz"}`;
    const url = `https://github.com/router-for-me/CLIProxyAPI/releases/download/v${proxyVersion}/${archiveName}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    if (!response.ok) throw new Error("The subscription proxy download failed.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== checksum) {
      throw new Error("The subscription proxy download could not be verified.");
    }

    const archive = join(temp, archiveName);
    await writeFile(archive, bytes);
    const contents = join(temp, "contents");
    await mkdir(contents);
    await run("tar", ["-xf", archive, "-C", contents, executable, "LICENSE"]);
    await chmod(join(contents, executable), 0o755);
    try {
      await rename(contents, installPath);
    } catch (error) {
      // Another local instance can install the same verified release first.
      await access(binary).catch(() => {
        throw error;
      });
    }
    return binary;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
