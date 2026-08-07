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
 * token gh already holds, so nobody has to manage a secret just for this.
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

const RETRY_DELAYS_MS = [400, 1200];

/**
 * One GraphQL round trip, retried on transient failure.
 *
 * GitHub returns 502s often enough that a first run — which has no cache to
 * fall back on — would otherwise fail outright on a blip. Only 5xx and network
 * errors are retried: a 4xx is an auth or permission problem and retrying it
 * just makes the user wait longer for the same answer.
 */
async function gql(token: string, query: string, variables: Record<string, unknown>) {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await Bun.sleep(RETRY_DELAYS_MS[attempt - 1]!);

    let res: Response;
    try {
      res = await fetch(API, {
        method: "POST",
        headers: {
          authorization: `bearer ${token}`,
          "content-type": "application/json",
          "user-agent": "shelf",
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      lastError = new Error(`could not reach GitHub: ${err instanceof Error ? err.message : String(err)}`);
      continue; // network failure: worth another go
    }

    // GitHub answers GraphQL errors with HTTP 200 and a valid JSON body, so the
    // status check alone is not enough — always look at body.errors too.
    let body: any;
    try {
      body = await res.json();
    } catch {
      if (res.status >= 500) {
        lastError = new Error(`GitHub returned non-JSON (HTTP ${res.status})`);
        continue;
      }
      throw new Error(`GitHub returned non-JSON (HTTP ${res.status})`);
    }

    if (body?.errors?.length) {
      throw new Error(body.errors.map((e: GqlNode) => e.message).join("; "));
    }
    if (res.status >= 500) {
      lastError = new Error(`GitHub API HTTP ${res.status} ${res.statusText}`);
      continue;
    }
    if (!res.ok) {
      const hint =
        res.status === 401
          ? " — the token was rejected; check GITHUB_TOKEN or run: gh auth login"
          : res.status === 403
            ? " — forbidden; the token may lack the scopes to read your repos"
            : "";
      throw new Error(`GitHub API HTTP ${res.status} ${res.statusText}${hint}`);
    }
    if (!body?.data?.viewer) throw new Error("GitHub response had no viewer data");
    return body.data;
  }

  throw new Error(`${lastError?.message ?? "GitHub request failed"} (after ${RETRY_DELAYS_MS.length + 1} tries)`);
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

export type RepoDetail = {
  commits: CommitLine[];
  readme: string | null;
  languages: { name: string; pct: number }[];
  latestRelease: { tag: string; publishedAt: string } | null;
};

/**
 * One bounded live call behind a repo card: commits, README body, language
 * split and latest release. Measured ~0.75s. README is capped by GitHub's own
 * blob truncation, which `isTruncated` reports.
 */
export async function fetchRepoDetail(repo: string, limit = 10): Promise<RepoDetail> {
  const token = githubToken();
  const query = `query($name: String!, $limit: Int!) {
  viewer {
    repository(name: $name) {
      md: object(expression: "HEAD:README.md") { ... on Blob { text isTruncated } }
      lower: object(expression: "HEAD:readme.md") { ... on Blob { text isTruncated } }
      plain: object(expression: "HEAD:README") { ... on Blob { text isTruncated } }
      languages(first: 8, orderBy: {field: SIZE, direction: DESC}) {
        totalSize
        edges { size node { name } }
      }
      latestRelease { tagName publishedAt }
      defaultBranchRef { target { ... on Commit {
        history(first: $limit) { nodes { committedDate messageHeadline } }
      } } }
    }
  }
}`;
  const data = await gql(token, query, { name: repo, limit });
  const r = data.viewer?.repository;
  if (!r) throw new Error(`no repository named ${repo}`);

  const blob = r.md ?? r.lower ?? r.plain ?? null;
  const total = r.languages?.totalSize ?? 0;

  return {
    commits: (r.defaultBranchRef?.target?.history?.nodes ?? []).map((n: GqlNode) => ({
      date: n.committedDate,
      message: n.messageHeadline,
    })),
    readme: blob?.text ?? null,
    languages: total
      ? (r.languages.edges ?? []).map((e: GqlNode) => ({
          name: e.node.name,
          pct: Math.round((e.size / total) * 100),
        }))
      : [],
    latestRelease: r.latestRelease
      ? { tag: r.latestRelease.tagName, publishedAt: r.latestRelease.publishedAt }
      : null,
  };
}

/** Kept for the commits-only path. */
export async function fetchRecentCommits(repo: string, limit = 8): Promise<CommitLine[]> {
  return (await fetchRepoDetail(repo, limit)).commits;
}

export type LinkResult = {
  repo: string;
  url: string;
  status: number | null;
  error?: string;
  attempts: number;
};

/**
 * Fetch each homepage URL, retrying once when the request itself fails.
 *
 * A single timeout is NOT evidence a site is dead: a transient blip once made
 * this report three live Vercel apps as dead links, and cold starts on free
 * tiers genuinely exceed a short deadline. So the budget is generous and one
 * network failure is retried before anything is claimed. An HTTP status is
 * never retried — the server answered, and that answer is the finding.
 */
export async function checkLinks(
  urls: { repo: string; url: string }[],
  timeoutMs = 10_000,
): Promise<LinkResult[]> {
  const once = (url: string) =>
    fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "shelf link-check" },
    });

  return Promise.all(
    urls.map(async ({ repo, url }) => {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await once(url);
          return { repo, url, status: res.status, attempts: attempt };
        } catch (err) {
          if (attempt === 2) {
            return {
              repo,
              url,
              status: null,
              error: err instanceof Error ? err.message : String(err),
              attempts: attempt,
            };
          }
        }
      }
      return { repo, url, status: null, error: "unreachable", attempts: 2 };
    }),
  );
}
