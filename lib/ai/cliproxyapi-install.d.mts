export const proxyVersion: string;
export function proxyExecutable(platform?: NodeJS.Platform): string;
export function installCliProxy(
  root: string,
  platform?: NodeJS.Platform,
  arch?: string,
): Promise<string>;
