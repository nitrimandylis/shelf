#!/usr/bin/env bun
import { loadConfig, configPath, shortenHome, normalizeScanPath, updateConfig, type Config } from "./config.ts";
import { loadRepos, fetchRepoDetail, checkLinks, type CommitLine } from "./github.ts";
import { scanLocal, recentCommits, localReadme, scanRoots, realPath } from "./local.ts";
import { mergeEntries, auditOffline, relTime, type Entry, type AuditReport } from "./model.ts";
import { triageView, auditView, showView, indexView, type View, type ShowExtras } from "./views.ts";
import { renderView } from "./term.ts";
import { renderHtml, serveView } from "./html.ts";
import { renderMarkdown } from "./markdown.ts";

const VERSION = "0.1.0";

const HELP = `shelf ${VERSION} — every repo you have, on GitHub and on this machine

usage
  shelf [options]              triage: what is warm, what is cold, what is unpushed
  shelf audit [options]        hygiene plus the checks that actually fire
  shelf show <repo>            one repo on one screen
  shelf index [options]        uncurated list of every public repo
  shelf scan                   where it looks for local repos
  shelf scan --add PATH        add a scan root
  shelf scan --remove PATH     drop one

options
  --all           include cold repos in triage instead of collapsing them
  --refresh       refetch from GitHub, ignoring the cache TTL
  --json          machine output: one JSON value on stdout, nothing else
  --html          render in a browser (ephemeral localhost server, ctrl-c to stop; not for scan)
  -o, --out FILE  write the HTML to a file instead of serving it (not for scan)
  --no-open       with --html, do not launch the browser
  --no-links      with audit, skip the homepage link check (no network)
  -h, --help      this
  -V, --version   version

data
  GitHub is cached at ~/.cache/shelf/repos.json (TTL from config, default 60m).
  The local git scan runs live on every invocation.
  Config: ${configPath()}
  Auth: GITHUB_TOKEN (or GH_TOKEN), falling back to the token from \`gh auth token\`.
`;

// ---------------------------------------------------------------- args

type Flags = {
  json: boolean;
  html: boolean;
  all: boolean;
  refresh: boolean;
  open: boolean;
  links: boolean;
  out: string | null;
  add: string | null;
  remove: string | null;
};

export function parseArgs(argv: string[]): { cmd: string; args: string[]; flags: Flags } {
  const flags: Flags = {
    json: false, html: false, all: false, refresh: false, open: true, links: true,
    out: null, add: null, remove: null,
  };
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--json") flags.json = true;
    else if (a === "--html") flags.html = true;
    else if (a === "--all") flags.all = true;
    else if (a === "--refresh") flags.refresh = true;
    else if (a === "--no-open") flags.open = false;
    else if (a === "--no-links") flags.links = false;
    else if (a === "-o" || a === "--out") {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a file path`);
      flags.out = v;
    } else if (a === "--add" || a === "--remove") {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a path\n  shelf scan ${a} ~/some/dir`);
      if (a === "--add") flags.add = v;
      else flags.remove = v;
    } else if (a.startsWith("-") && a !== "-") {
      throw new Error(`unknown option: ${a}`);
    } else rest.push(a);
  }

  return { cmd: rest[0] ?? "triage", args: rest.slice(1), flags };
}

// ---------------------------------------------------------------- data

type Gathered = {
  cfg: Config;
  login: string;
  entries: Entry[];
  meta: string;
  warning?: string;
  fetchedAt: string;
  cacheAgeMinutes: number;
};

async function gather(cfg: Config, force: boolean, now = Date.now()): Promise<Gathered> {
  const [repoLoad, locals] = await Promise.all([
    loadRepos(cfg, { force, now }),
    scanLocal(cfg),
  ]);

  const entries = mergeEntries(repoLoad.cache.repos, locals, repoLoad.cache.login).filter(
    (e) => !cfg.exclude.includes(e.name),
  );

  const rel = relTime(Date.parse(repoLoad.cache.fetchedAt), now);
  const age = repoLoad.refreshed || rel === "now" ? "just now" : `${rel} ago`;

  // Degrade rather than die, but say so: without git the local half of the
  // whole premise is missing, and silence looks like "you have no local repos".
  const warnings = [repoLoad.warning];
  if (!Bun.which("git")) {
    warnings.push("git is not on PATH, so no local repos were scanned");
  } else if (locals.length === 0) {
    // Half the point of the tool is the local side. Finding nothing usually
    // means the scan roots are wrong, not that there is nothing to find.
    warnings.push(
      "no local repos found — run: shelf scan   to see where it looked",
    );
  }

  return {
    cfg,
    login: repoLoad.cache.login,
    entries,
    meta: `${entries.length} repos · github ${age} · local ${Bun.which("git") ? "live" : "unavailable"}`,
    warning: warnings.filter(Boolean).join(" · ") || undefined,
    fetchedAt: repoLoad.cache.fetchedAt,
    cacheAgeMinutes: repoLoad.ageMinutes,
  };
}

// ---------------------------------------------------------------- json

function entryJson(e: Entry) {
  const g = e.gh;
  const l = e.local;
  return {
    name: e.name,
    state: e.state,
    external: e.external,
    // null on every GitHub field means "not on GitHub", not "unknown"
    visibility: g?.visibility ?? null,
    description: g?.description ?? null,
    language: g?.language ?? null,
    archived: g?.archived ?? null,
    fork: g?.fork ?? null,
    pushedAt: g?.pushedAt ?? null,
    createdAt: g?.createdAt ?? null,
    sizeKb: g?.diskUsageKb ?? null,
    homepage: g?.homepage ?? null,
    stars: g?.stars ?? null,
    license: g?.license ?? null,
    topics: g?.topics ?? null,
    openIssues: g?.openIssues ?? null,
    openPRs: g?.openPRs ?? null,
    hasReadme: g?.hasReadme ?? null,
    defaultBranch: g?.defaultBranch ?? null,
    commits8w: g?.commits8w ?? null,
    weeks: g?.weeks ?? null,
    ci: g?.ci ?? null,
    lastCommit: g?.lastCommit ?? null,
    // null on every local field means "not on this machine"
    path: l?.path ?? null,
    branch: l?.branch ?? null,
    upstream: l?.upstream ?? null,
    dirty: l?.dirty ?? null,
    ahead: l?.ahead ?? null,
    behind: l?.behind ?? null,
    localLastCommitAt: l?.lastCommitAt ?? null,
  };
}

function emit(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

// ---------------------------------------------------------------- output

async function present(view: View, flags: Flags): Promise<void> {
  if (flags.out) {
    await Bun.write(flags.out, renderHtml(view, { refreshable: false }));
    console.error(`wrote ${flags.out}`);
    return;
  }
  process.stdout.write(renderView(view));
}

/** --html on any command: serve it, rebuilding on refresh. */
async function presentHtml(
  build: (force: boolean) => Promise<View>,
  flags: Flags,
  repo?: (name: string) => Promise<View>,
): Promise<void> {
  if (flags.out) {
    // A static file has no server to answer card requests, so it ships without
    // them; rows fall back to opening the repo on GitHub.
    await Bun.write(flags.out, renderHtml(await build(flags.refresh), { refreshable: false }));
    console.error(`wrote ${flags.out}`);
    return;
  }
  await serveView(build, { open: flags.open, repo });
}

// ---------------------------------------------------------------- audit

async function buildAudit(g: Gathered, links: boolean): Promise<AuditReport> {
  const offline = auditOffline(g.entries, Date.now(), {
    activeDays: g.cfg.activeDays,
    heavyMb: g.cfg.heavyMb,
  });

  if (!links) {
    return { ...offline, deadLinks: [] };
  }

  const urls = g.entries
    .filter((e) => e.gh?.homepage)
    .map((e) => ({ repo: e.name, url: e.gh!.homepage! }));

  const results = await checkLinks(urls);
  const deadLinks = results
    .filter((r) => r.status === null || r.status >= 400)
    .map((r) => ({
      repo: r.repo,
      // "answered with an error" and "did not answer" are different strengths
      // of evidence, and the report says which one it is.
      detail:
        r.status === null
          ? `${r.url} — no answer after ${r.attempts} tries (${r.error})`
          : `${r.url} — HTTP ${r.status}`,
      url: r.url,
      kind: r.status === null ? ("no-answer" as const) : ("http-error" as const),
    }))
    .sort((a, b) => a.repo.localeCompare(b.repo));

  return { ...offline, deadLinks };
}

// ---------------------------------------------------------------- commands

async function cmdTriage(cfg: Config, flags: Flags): Promise<void> {
  const build = async (force: boolean) => {
    const g = await gather(cfg, force);
    return triageView(g.entries, {
      login: g.login,
      now: Date.now(),
      activeDays: cfg.activeDays,
      // The browser page shows everything: there is no scrollback to protect.
      showAll: flags.all || flags.html,
      meta: g.meta,
      warning: g.warning,
    });
  };

  if (flags.json) {
    const g = await gather(cfg, flags.refresh);
    emit({
      fetchedAt: g.fetchedAt,
      cacheAgeMinutes: Math.round(g.cacheAgeMinutes * 10) / 10,
      login: g.login,
      // null when nothing is wrong. Tells a consumer the difference between
      // "no local clones" and "the scan roots are misconfigured".
      warning: g.warning ?? null,
      scanPaths: g.cfg.scanPaths,
      repos: g.entries.map(entryJson),
    });
    return;
  }

  if (flags.html) return presentHtml(build, flags, (name) => buildRepoView(cfg, name));
  await present(await build(flags.refresh), flags);
}

async function cmdAudit(cfg: Config, flags: Flags): Promise<void> {
  const build = async (force: boolean) => {
    const g = await gather(cfg, force);
    const report = await buildAudit(g, flags.links);
    return auditView(report, {
      meta: g.meta,
      login: g.login,
      activeDays: cfg.activeDays,
      heavyMb: cfg.heavyMb,
      warning: g.warning,
    });
  };

  if (flags.json) {
    const g = await gather(cfg, flags.refresh);
    const r = await buildAudit(g, flags.links);
    emit({
      hygiene: r.hygiene,
      stale: r.stale,
      deadLinks: r.deadLinks,
      heavy: r.heavy,
      unpublished: r.unpublished,
      privateSkipped: r.skippedPrivate,
      linksChecked: flags.links,
    });
    return;
  }

  if (flags.html) return presentHtml(build, flags, (name) => buildRepoView(cfg, name));
  await present(await build(flags.refresh), flags);
}

/**
 * Everything behind a repo card. GitHub answers for published repos; a repo
 * that only exists on this machine still gets its commits and README, read
 * straight off disk.
 */
async function loadDetail(
  e: Entry,
): Promise<{ commits: CommitLine[]; extra: ShowExtras; error?: string }> {
  if (e.gh) {
    try {
      const d = await fetchRepoDetail(e.gh.name);
      return {
        commits: d.commits,
        extra: {
          readmeHtml: d.readme ? renderMarkdown(d.readme) : null,
          languages: d.languages,
          latestRelease: d.latestRelease,
        },
      };
    } catch (err) {
      return { commits: [], extra: {}, error: err instanceof Error ? err.message : String(err) };
    }
  }
  if (e.local) {
    const raw = await localReadme(e.local.path);
    return {
      commits: await recentCommits(e.local.path, 10),
      extra: { readmeHtml: raw ? renderMarkdown(raw) : null },
    };
  }
  return { commits: [], extra: {} };
}

async function cmdShow(cfg: Config, flags: Flags, name: string | undefined): Promise<void> {
  if (!name) {
    console.error("show needs a repo name\n  shelf show <repo>");
    process.exitCode = 1;
    return;
  }

  const g = await gather(cfg, flags.refresh);
  const entry = g.entries.find((e) => e.name.toLowerCase() === name.toLowerCase());

  if (!entry) {
    const near = g.entries
      .filter((e) => e.name.toLowerCase().includes(name.toLowerCase()))
      .map((e) => e.name);
    console.error(`no repo named "${name}"`);
    if (near.length) console.error(`  did you mean: ${near.slice(0, 5).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const { commits, extra, error } = await loadDetail(entry);

  if (flags.json) {
    emit({
      ...entryJson(entry),
      recentCommits: commits,
      languages: extra.languages ?? null,
      latestRelease: extra.latestRelease ?? null,
      hasReadmeBody: extra.readmeHtml != null,
    });
    return;
  }

  const view = showView(
    entry,
    commits,
    {
      login: g.login,
      now: Date.now(),
      meta: g.meta,
      commitError: error ? `could not load commits: ${error}` : undefined,
    },
    extra,
  );

  if (flags.html) return presentHtml(async () => view, flags);
  await present(view, flags);
}

/** The card payload: the same View model the page already knows how to draw. */
async function buildRepoView(cfg: Config, name: string): Promise<View> {
  const g = await gather(cfg, false);
  const entry = g.entries.find((e) => e.name.toLowerCase() === name.toLowerCase());
  if (!entry) throw new Error(`no repo named "${name}"`);
  const { commits, extra, error } = await loadDetail(entry);
  return showView(
    entry,
    commits,
    {
      login: g.login,
      now: Date.now(),
      meta: g.meta,
      commitError: error ? `could not load commits: ${error}` : undefined,
    },
    extra,
  );
}

/**
 * Where shelf looks for local repos, and the only place that changes it.
 * Hand-editing JSON is a poor answer to "it found nothing", which is the most
 * likely first-run confusion.
 */
async function cmdScan(cfg: Config, flags: Flags): Promise<void> {
  if (flags.html || flags.out) {
    console.error("scan has no html view, so --html and -o do not apply; use --json for machine output");
    process.exitCode = 1;
    return;
  }
  const target = flags.add ?? flags.remove;

  if (target) {
    if (flags.add && flags.remove) {
      console.error("--add and --remove cannot be combined");
      process.exitCode = 1;
      return;
    }
    const action = flags.add ? "--add" : "--remove";
    const path = normalizeScanPath(target);
    // Compare resolved paths, not the strings: `.`, `~/Sites` and an absolute
    // path can all name the same directory.
    const resolved = realPath(path);
    const existing = cfg.scanPaths.find((p) => realPath(p) === resolved);
    const has = existing !== undefined;

    if (action === "--add" && has) {
      console.error(
        existing === path
          ? `${path} is already a scan root`
          : `${path} is already a scan root, listed as ${existing}`,
      );
      process.exitCode = 1;
      return;
    }
    if (action === "--remove" && !has) {
      console.error(`${path} is not a scan root\n  shelf scan   to list them`);
      process.exitCode = 1;
      return;
    }

    await updateConfig((raw) => {
      const current = Array.isArray(raw.scanPaths) ? (raw.scanPaths as string[]) : cfg.scanPaths;
      raw.scanPaths =
        action === "--add" ? [...current, path] : current.filter((p) => realPath(p) !== resolved);
    });

    if (action === "--remove") {
      console.log(`removed ${path}`);
      return;
    }
    const found = scanRoots([path], cfg.scanDepth)[0]!;
    console.log(
      found.exists
        ? `added ${path} — ${found.repos} ${found.repos === 1 ? "repo" : "repos"} found`
        : `added ${path} — not found on this machine yet`,
    );
    return;
  }

  const roots = scanRoots(cfg.scanPaths, cfg.scanDepth);
  if (flags.json) {
    emit({ configPath: shortenHome(configPath()), scanDepth: cfg.scanDepth, roots });
    return;
  }

  const live = roots.filter((r) => r.exists).length;
  const total = roots.reduce((a, r) => a + r.repos, 0);
  const width = Math.max(...roots.map((r) => r.path.length), 4);

  console.log(`scan roots · ${live} of ${roots.length} exist · ${total} repos · ${shortenHome(configPath())}`);
  for (const r of roots) {
    const mark = r.exists ? "✓" : "·";
    const note = r.exists ? `${r.repos} ${r.repos === 1 ? "repo" : "repos"}` : "not found";
    console.log(`  ${mark} ${r.path.padEnd(width)}  ${note}`);
  }
  console.log(`\n  shelf scan --add ~/somewhere    to add a root`);
  console.log(`  shelf scan --remove ~/somewhere to drop one`);
}

async function cmdIndex(cfg: Config, flags: Flags): Promise<void> {
  const build = async (force: boolean) => {
    const g = await gather(cfg, force);
    return indexView(g.entries, { login: g.login, meta: g.meta, now: Date.now() });
  };

  if (flags.json) {
    const g = await gather(cfg, flags.refresh);
    emit({
      login: g.login,
      repos: g.entries
        .filter((e) => e.gh?.visibility === "public" && !e.gh.fork)
        .map(entryJson),
    });
    return;
  }

  // index is the one view whose natural home is a file, so -o and --html both work
  if (flags.html || flags.out) return presentHtml(build, flags, (name) => buildRepoView(cfg, name));
  await present(await build(flags.refresh), flags);
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // Before anything else: no config read, no network, no token probe.
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(HELP);
    return;
  }
  if (argv.includes("-V") || argv.includes("--version")) {
    console.log(`shelf ${VERSION}`);
    return;
  }

  const { cmd, args, flags } = parseArgs(argv);
  const cfg = await loadConfig();

  // First run: say where the knobs are. On stderr so --json stays clean.
  if (cfg.created && !flags.json) {
    console.error(`wrote default config to ${shortenHome(configPath())}`);
  }

  switch (cmd) {
    case "triage":
      return cmdTriage(cfg, flags);
    case "audit":
      return cmdAudit(cfg, flags);
    case "show":
      return cmdShow(cfg, flags, args[0]);
    case "index":
      return cmdIndex(cfg, flags);
    case "scan":
      return cmdScan(cfg, flags);
    default:
      console.error(`unknown command: ${cmd}\n  try: shelf --help`);
      process.exitCode = 1;
  }
}

// Guarded so the test file can import parseArgs without running the CLI.
if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
