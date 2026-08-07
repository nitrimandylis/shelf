import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

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

/**
 * Normalise a path a user typed: accepts `~/x`, `./x`, `x` and absolute paths,
 * and stores it tilde-relative when it is under home so the config stays
 * portable between machines and users.
 */
export function normalizeScanPath(input: string): string {
  return shortenHome(resolve(expandTilde(input.trim())));
}

/**
 * Rewrite the config file, preserving any keys shelf does not know about.
 * Reads the raw file rather than the merged object so a hand-added key is not
 * silently dropped the first time the user runs a command that writes.
 */
export async function updateConfig(mutate: (raw: Record<string, unknown>) => void): Promise<void> {
  const path = configPath();
  let raw: Record<string, unknown> = {};
  const file = Bun.file(path);
  if (await file.exists()) {
    try {
      const parsed = await file.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed;
    } catch {
      throw new Error(`config is not valid JSON: ${shortenHome(path)}\n  fix it, or delete it to get the defaults back`);
    }
  } else {
    raw = { ...DEFAULTS };
  }
  mutate(raw);
  mkdirSync(configDir(), { recursive: true });
  await Bun.write(path, JSON.stringify(raw, null, 2) + "\n");
}

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
