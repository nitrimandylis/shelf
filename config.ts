import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export type Config = {
  scanPaths: string[];
  scanDepth: number;
  activeDays: number;
  cacheTtlMinutes: number;
  heavyMb: number;
  exclude: string[];
};

/**
 * Common places people keep code. Roots that do not exist are skipped, so
 * listing several costs nothing and means the tool finds local repos on a
 * machine it has never seen. Anyone whose code lives elsewhere sets scanPaths
 * in the config file, which is written on first run.
 */
export const DEFAULT_SCAN_PATHS = [
  "~/code",
  "~/src",
  "~/dev",
  "~/develop",
  "~/Developer",
  "~/projects",
  "~/repos",
  "~/git",
  "~/work",
  "~/workspace",
];

export const DEFAULTS: Config = {
  scanPaths: DEFAULT_SCAN_PATHS,
  scanDepth: 2,
  activeDays: 90,
  cacheTtlMinutes: 60,
  heavyMb: 20,
  exclude: [],
};

/** Inverse of expandTilde, for messages: /Users/x/.config/... -> ~/.config/... */
export function shortenHome(p: string): string {
  const home = homedir();
  return p.startsWith(home + "/") ? "~" + p.slice(home.length) : p;
}

export function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

export const configDir = () => join(homedir(), ".config", "shelf");
export const configPath = () => join(configDir(), "config.json");
export const cacheDir = () => join(homedir(), ".cache", "shelf");
export const cachePath = () => join(cacheDir(), "repos.json");

/** Reads config, writing the default file on first run so it is discoverable. */
export async function loadConfig(): Promise<Config & { created?: boolean }> {
  const path = configPath();
  const file = Bun.file(path);
  if (!(await file.exists())) {
    mkdirSync(configDir(), { recursive: true });
    await Bun.write(path, JSON.stringify(DEFAULTS, null, 2) + "\n");
    return { ...DEFAULTS, created: true };
  }
  let raw: unknown;
  try {
    raw = await file.json();
  } catch {
    throw new Error(`config is not valid JSON: ${shortenHome(path)}\n  fix it, or delete it to get the defaults back`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`config must be a JSON object: ${shortenHome(path)}`);
  }
  return { ...DEFAULTS, ...(raw as Partial<Config>) };
}
