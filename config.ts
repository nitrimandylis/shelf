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

export const DEFAULTS: Config = {
  scanPaths: ["~/cc", "~/Developer"],
  scanDepth: 2,
  activeDays: 90,
  cacheTtlMinutes: 60,
  heavyMb: 20,
  exclude: [],
};

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
export async function loadConfig(): Promise<Config> {
  const path = configPath();
  const file = Bun.file(path);
  if (!(await file.exists())) {
    mkdirSync(configDir(), { recursive: true });
    await Bun.write(path, JSON.stringify(DEFAULTS, null, 2) + "\n");
    return { ...DEFAULTS };
  }
  let raw: unknown;
  try {
    raw = await file.json();
  } catch {
    throw new Error(`config is not valid JSON: ${path}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`config must be a JSON object: ${path}`);
  }
  return { ...DEFAULTS, ...(raw as Partial<Config>) };
}
