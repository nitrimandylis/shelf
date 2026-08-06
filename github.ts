import { mkdirSync } from "node:fs";
import { cacheDir, cachePath, type Config } from "./config.ts";
import type { Repo } from "./model.ts";

const API = "https://api.github.com/graphql";
const WEEKS = 8;
const DAY = 86_400_000;

export type Cache = {
  fetchedAt: string;
  login: string;
  repos: Repo[];
};

// ---------------------------------------------------------------- auth

/**
 * GITHUB_TOKEN first so a stranger (or CI) can set one, falling back to the
 * token gh already holds so Nick never has to manage a secret for this.
 */
export function githubToken(): string {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env && env.trim()) return env.trim();

  const gh = Bun.which("gh");
  if (gh) {
    const p = Bun.spawnSync([gh, "auth", "token"], { stdout: "pipe", stderr: "pipe" });
    const out = p.stdout.toString().trim();
    if (p.exitCode === 0 && out) return out;
  }

  throw new Error("no GitHub token\n  set GITHUB_TOKEN, or run: gh auth login");
}

// ---------------------------------------------------------------- query

/**
 * Eight aliased history(since:, until:) counts rather than a single
 * history(first: 100) node list: totalCount per week is exact, where the node
 * list caps at 100 and silently drops the OLDEST weeks on a busy repo.
 * Measured cost: 1 point, ~5s for 40 repos, and it does not grow with fields.
 */
function buildQuery(now: number): string {
  const buckets: string[] = [];
  for (let i = 0; i < WEEKS; i++) {
    const since = new Date(now - (WEEKS - i) * 7 * DAY).toISOString();
    const until = new Date(now - (WEEKS - 1 - i) * 7 * DAY).toISOString();
    buckets.push(`w${i}: history(since: "${since}", until: "${until}") { totalCount }`);
  }

  return `query($after: String) {
  viewer {
    login
    repositories(first: 100, after: $after, ownerAffiliations: OWNER, orderBy: {field: PUSHED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        description
        isPrivate
        isArchived
        isFork
        pushedAt
        createdAt
        diskUsage
        homepageUrl
        stargazerCount
        primaryLanguage { name }
        licenseInfo { spdxId }
        repositoryTopics(first: 20) { nodes { topic { name } } }
        issues(states: OPEN) { totalCount }
        pullRequests(states: OPEN) { totalCount }
        readmeMd: object(expression: "HEAD:README.md") { __typename }
        readmeLower: object(expression: "HEAD:readme.md") { __typename }
        readmeNoExt: object(expression: "HEAD:README") { __typename }
        defaultBranchRef {
          name
          target {
            ... on Commit {
              committedDate
              messageHeadline
              statusCheckRollup { state }
              ${buckets.join("\n              ")}
            }
          }
        }
      }
    }
  }
}`;
}

type GqlNode = Record<string, any>;

function normalize(n: GqlNode): Repo {
  const target = n.defaultBranchRef?.target ?? null;
  const weeks: number[] = [];
  for (let i = 0; i < WEEKS; i++) weeks.push(target?.[`w${i}`]?.totalCount ?? 0);

  return {
    name: n.name,
    description: n.description || null,
    visibility: n.isPrivate ? "private" : "public",
    archived: !!n.isArchived,
    fork: !!n.isFork,
    language: n.primaryLanguage?.name ?? null,
    pushedAt: n.pushedAt,
    createdAt: n.createdAt,
    diskUsageKb: n.diskUsage ?? 0,
    homepage: n.homepageUrl || null,
    stars: n.stargazerCount ?? 0,
    license: n.licenseInfo?.spdxId ?? null,
    topics: (n.repositoryTopics?.nodes ?? []).map((t: GqlNode) => t.topic.name),
    openIssues: n.issues?.totalCount ?? 0,
    openPRs: n.pullRequests?.totalCount ?? 0,
    hasReadme: !!(n.readmeMd || n.readmeLower || n.readmeNoExt),
    defaultBranch: n.defaultBranchRef?.name ?? null,
    lastCommit: target?.committedDate
      ? { date: target.committedDate, message: target.messageHeadline ?? "" }
      : null,
    weeks,
    commits8w: weeks.reduce((a, b) => a + b, 0),
    ci: target?.statusCheckRollup?.state ?? null,
  };
}

async function gql(token: string, query: string, variables: Record<string, unknown>) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      authorization: `bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "shelf",
    },
    body: JSON.stringify({ query, variables }),
  });

  // GitHub answers GraphQL errors with HTTP 200 and a valid JSON body, so the
  // status check alone is not enough — always look at body.errors too.
  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new Error(`GitHub returned non-JSON (HTTP ${res.status})`);
  }
  if (body?.errors?.length) {
    throw new Error(body.errors.map((e: GqlNode) => e.message).join("; "));
  }
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status} ${res.statusText}`);
  if (!body?.data?.viewer) throw new Error("GitHub response had no viewer data");
  return body.data;
}

export async function fetchRepos(now = Date.now()): Promise<Cache> {
  const token = githubToken();
  const query = buildQuery(now);

  const repos: Repo[] = [];
  let login = "";
  let after: string | null = null;

  // Paginate even though 40 fits in one page — the page cap is a silent
  // truncation the day it is crossed.
  for (let page = 0; page < 10; page++) {
    const data = await gql(token, query, { after });
    login = data.viewer.login;
    const conn = data.viewer.repositories;
    for (const n of conn.nodes) repos.push(normalize(n));
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }

  return { fetchedAt: new Date(now).toISOString(), login, repos };
}

// ---------------------------------------------------------------- cache

export async function readCache(): Promise<Cache | null> {
  const f = Bun.file(cachePath());
  if (!(await f.exists())) return null;
  try {
    const c = (await f.json()) as Cache;
    if (!c?.repos || !Array.isArray(c.repos) || !c.login) return null;
    return c;
  } catch {
    return null;
  }
}

export async function writeCache(c: Cache): Promise<void> {
  mkdirSync(cacheDir(), { recursive: true });
  await Bun.write(cachePath(), JSON.stringify(c));
}

export function cacheAgeMinutes(c: Cache, now: number): number {
  const t = Date.parse(c.fetchedAt);
  if (!Number.isFinite(t)) return Infinity;
  return (now - t) / 60_000;
}

export type LoadResult = { cache: Cache; ageMinutes: number; refreshed: boolean };

/**
 * Cache-first with a TTL. If a refresh fails but a stale cache exists we serve
 * the stale copy and say so, rather than failing a read that could be answered.
 */
export async function loadRepos(
  cfg: Config,
  opts: { force?: boolean; now?: number } = {},
): Promise<LoadResult & { warning?: string }> {
  const now = opts.now ?? Date.now();
  const cached = await readCache();
  const age = cached ? cacheAgeMinutes(cached, now) : Infinity;

  if (!opts.force && cached && age < cfg.cacheTtlMinutes) {
    return { cache: cached, ageMinutes: age, refreshed: false };
  }

  try {
    const fresh = await fetchRepos(now);
    await writeCache(fresh);
    return { cache: fresh, ageMinutes: 0, refreshed: true };
  } catch (err) {
    if (cached) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        cache: cached,
        ageMinutes: age,
        refreshed: false,
        warning: `refresh failed (${msg.split("\n")[0]}), showing cached data`,
      };
    }
    throw err;
  }
}

// ---------------------------------------------------------------- extras

export type CommitLine = { date: string; message: string };

/** One bounded live call for `show`: recent commits on the default branch. */
export async function fetchRecentCommits(repo: string, limit = 8): Promise<CommitLine[]> {
  const token = githubToken();
  const query = `query($name: String!, $limit: Int!) {
  viewer {
    repository(name: $name) {
      defaultBranchRef { target { ... on Commit {
        history(first: $limit) { nodes { committedDate messageHeadline } }
      } } }
    }
  }
}`;
  const data = await gql(token, query, { name: repo, limit });
  const nodes = data.viewer?.repository?.defaultBranchRef?.target?.history?.nodes ?? [];
  return nodes.map((n: GqlNode) => ({ date: n.committedDate, message: n.messageHeadline }));
}

/** HEAD each homepage URL. Returns null status when the request itself failed. */
export async function checkLinks(
  urls: { repo: string; url: string }[],
  timeoutMs = 5000,
): Promise<{ repo: string; url: string; status: number | null; error?: string }[]> {
  return Promise.all(
    urls.map(async ({ repo, url }) => {
      try {
        const res = await fetch(url, {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { "user-agent": "shelf link-check" },
        });
        return { repo, url, status: res.status };
      } catch (err) {
        return {
          repo,
          url,
          status: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}
