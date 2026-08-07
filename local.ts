import { readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { expandTilde, type Config } from "./config.ts";
import { weekBuckets, WEEKS, type LocalRepo } from "./model.ts";

// ---------------------------------------------------------------- parsing

export type GitStatus = {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  dirty: number;
};

/**
 * Parse `git status --porcelain=v2 --branch`. One call gives branch, upstream,
 * ahead/behind and the changed-file count, which is why v2 is worth the parse.
 */
export function parseStatus(text: string): GitStatus {
  const out: GitStatus = { branch: null, upstream: null, ahead: 0, behind: 0, dirty: 0 };
  for (const line of text.split("\n")) {
    if (!line) continue;
    if (line.startsWith("# branch.head ")) {
      const v = line.slice("# branch.head ".length).trim();
      out.branch = v === "(detached)" ? null : v;
    } else if (line.startsWith("# branch.upstream ")) {
      out.upstream = line.slice("# branch.upstream ".length).trim();
    } else if (line.startsWith("# branch.ab ")) {
      const m = line.match(/\+(\d+)\s+-(\d+)/);
      if (m) {
        out.ahead = Number(m[1]);
        out.behind = Number(m[2]);
      }
    } else if (!line.startsWith("#")) {
      // 1/2 = tracked change, u = unmerged, ? = untracked
      if (/^[12u?] /.test(line)) out.dirty++;
    }
  }
  return out;
}

/** owner/name out of any of the three URL shapes git hands back. */
export function parseRemote(url: string): { owner: string; name: string } | null {
  const u = url.trim();
  if (!u) return null;
  const patterns = [
    /^git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/,
    /^ssh:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/,
    /^https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/,
  ];
  for (const re of patterns) {
    const m = u.match(re);
    if (m) return { owner: m[1]!, name: m[2]!.replace(/\/$/, "") };
  }
  return null;
}

// ---------------------------------------------------------------- discovery

const SKIP = new Set(["node_modules", "Library", "Applications", "vendor", "target", "dist"]);

/**
 * Find git repos under the configured roots. Descends INTO repos as well,
 * because nested project repos are real here (~/Developer/neural/sidekick)
 * and stopping at the first .git would hide them.
 */
export function findRepos(roots: string[], maxDepth: number): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const walk = (dir: string, depth: number) => {
    if (existsSync(join(dir, ".git")) && !seen.has(dir)) {
      seen.add(dir);
      found.push(dir);
    }
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory is not an error worth failing the run over
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue; // never follow symlinks: loop risk
      if (ent.name.startsWith(".") || SKIP.has(ent.name)) continue;
      walk(join(dir, ent.name), depth + 1);
    }
  };

  for (const root of roots) {
    const dir = expandTilde(root);
    if (!existsSync(dir)) continue;
    walk(dir, 0);
  }
  return found;
}

// ---------------------------------------------------------------- git calls

async function git(cwd: string, args: string[]): Promise<string | null> {
  const bin = Bun.which("git");
  if (!bin) return null;
  const p = Bun.spawn([bin, "-C", cwd, ...args], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  const code = await p.exited;
  return code === 0 ? out : null;
}

async function inspect(path: string, now: number): Promise<LocalRepo> {
  const since = new Date(now - WEEKS * 7 * 86_400_000).toISOString();
  const [statusText, remoteText, lastText, logText] = await Promise.all([
    git(path, ["status", "--porcelain=v2", "--branch"]),
    git(path, ["remote", "get-url", "origin"]),
    git(path, ["log", "-1", "--format=%cI"]),
    // Local buckets so an unpublished repo still gets a sparkline — those are
    // exactly the repos GitHub cannot tell you anything about.
    git(path, ["log", `--since=${since}`, "--format=%cI"]),
  ]);

  const status = statusText ? parseStatus(statusText) : { branch: null, upstream: null, ahead: 0, behind: 0, dirty: 0 };
  const remote = remoteText ? parseRemote(remoteText) : null;
  const weeks = weekBuckets(logText ? logText.split("\n").filter(Boolean) : [], now);

  return {
    name: basename(path),
    path,
    branch: status.branch,
    upstream: status.upstream,
    ahead: status.ahead,
    behind: status.behind,
    dirty: status.dirty,
    remoteOwner: remote?.owner ?? null,
    remoteName: remote?.name ?? null,
    lastCommitAt: lastText?.trim() || null,
    weeks,
    commits8w: weeks.reduce((a, b) => a + b, 0),
  };
}

/** Recent commits straight from the clone, for repos with no GitHub side. */
export async function recentCommits(
  path: string,
  limit = 8,
): Promise<{ date: string; message: string }[]> {
  const out = await git(path, ["log", `-${limit}`, "--format=%cI%x1f%s"]);
  if (!out) return [];
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [date, message] = line.split("\x1f");
      return { date: date ?? "", message: message ?? "" };
    });
}

/** README straight off disk, for repos that have no GitHub side. */
export async function localReadme(path: string): Promise<string | null> {
  for (const name of ["README.md", "readme.md", "README"]) {
    const f = Bun.file(join(path, name));
    if (await f.exists()) return await f.text();
  }
  return null;
}

export async function scanLocal(cfg: Config): Promise<LocalRepo[]> {
  if (!Bun.which("git")) return [];
  const now = Date.now();
  const paths = findRepos(cfg.scanPaths, cfg.scanDepth);
  const repos = await Promise.all(paths.map((p) => inspect(p, now)));
  return repos.sort((a, b) => a.name.localeCompare(b.name));
}
