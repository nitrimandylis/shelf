// Builds the demo world the README gif is recorded against: a fake HOME with a
// canned GitHub cache, plus real git repos on disk for the live local scan.
//
// Timestamps are computed at build time, never committed, so the recorded ages
// ("3d", "2w") stay plausible no matter when the gif is re-recorded.
//
// Run: bun tapes/fixture.ts   (tapes/shelf.tape does this itself)

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "fixtures");
const home = join(root, "home");
const reposDir = join(home, "code");

const DAY = 86_400_000;
const now = Date.now();
const ago = (days: number) => new Date(now - days * DAY).toISOString();

// ---------------------------------------------------------------- git repos

function git(cwd: string, args: string[], date?: string) {
  const env = { ...process.env } as Record<string, string>;
  if (date) {
    env.GIT_AUTHOR_DATE = date;
    env.GIT_COMMITTER_DATE = date;
  }
  const p = Bun.spawnSync(["git", ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}\n${p.stderr.toString()}`);
  }
}

type LocalSpec = {
  name: string;
  origin?: string;
  readme: string;
  /** days ago, newest last */
  commits: { days: number; message: string }[];
  /** files left uncommitted, so the row reads "N dirty" */
  dirty?: string[];
};

const locals: LocalSpec[] = [
  {
    name: "harbor",
    origin: "https://github.com/nitrimandylis/harbor.git",
    readme: "# harbor\n\nthe published one — github knows about this, and so does this machine\n",
    commits: [
      { days: 21, message: "first cut of the parser" },
      { days: 14, message: "handle the empty-file case" },
      { days: 6, message: "swap the regex for a real tokenizer" },
      { days: 2, message: "docs: the flag table was a lie" },
    ],
    dirty: ["notes.md", "src/wip.ts"],
  },
  {
    name: "soundboard",
    readme: "# soundboard\n\nno origin, no github, no backup — the row shelf exists to print\n",
    commits: [
      { days: 30, message: "it makes a noise" },
      { days: 9, message: "it makes the right noise" },
      { days: 4, message: "keybinds" },
      { days: 1, message: "one more sample pack" },
    ],
  },
  {
    name: "wavelength",
    readme: "# wavelength\n\nalso unpublished, also fine, also invisible to `gh repo list`\n",
    commits: [
      { days: 40, message: "spike: fft in the terminal" },
      { days: 11, message: "actually render the bars" },
    ],
  },
];

function buildLocals() {
  for (const spec of locals) {
    const dir = join(reposDir, spec.name);
    mkdirSync(dir, { recursive: true });
    git(dir, ["init", "-q", "-b", "main"]);
    git(dir, ["config", "user.email", "demo@example.com"]);
    git(dir, ["config", "user.name", "demo"]);
    if (spec.origin) git(dir, ["remote", "add", "origin", spec.origin]);

    // README stays clean in every commit; a separate log file carries the churn
    // so the history has real diffs without the README picking up scaffolding.
    let log = "";
    Bun.write(join(dir, "README.md"), spec.readme);
    for (const c of spec.commits) {
      const date = new Date(now - c.days * DAY).toISOString();
      log += `${c.message}\n`;
      Bun.write(join(dir, "CHANGELOG.md"), log);
      git(dir, ["add", "-A"]);
      git(dir, ["commit", "-q", "-m", c.message], date);
    }

    for (const f of spec.dirty ?? []) {
      const p = join(dir, f);
      mkdirSync(join(p, ".."), { recursive: true });
      Bun.write(p, "work in progress\n");
    }
  }
}

// ---------------------------------------------------------------- gh cache

type CacheRepo = {
  name: string;
  description: string | null;
  visibility: "public" | "private";
  archived: boolean;
  fork: boolean;
  language: string | null;
  pushedAt: string;
  createdAt: string;
  diskUsageKb: number;
  homepage: string | null;
  stars: number;
  license: string | null;
  topics: string[];
  openIssues: number;
  openPRs: number;
  hasReadme: boolean;
  defaultBranch: string;
  lastCommit: { date: string; message: string };
  weeks: number[];
  commits8w: number;
  ci: string | null;
};

const repos: CacheRepo[] = [
  {
    name: "harbor",
    description: "a parser that refuses to guess",
    visibility: "public",
    archived: false,
    fork: false,
    language: "TypeScript",
    pushedAt: ago(2),
    createdAt: ago(140),
    diskUsageKb: 1840,
    homepage: null,
    stars: 12,
    license: "MIT",
    topics: ["parser", "typescript"],
    openIssues: 2,
    openPRs: 1,
    hasReadme: true,
    defaultBranch: "main",
    lastCommit: { date: ago(2), message: "docs: the flag table was a lie" },
    weeks: [0, 1, 3, 2, 0, 5, 4, 6],
    commits8w: 21,
    ci: "SUCCESS",
  },
  {
    name: "driftwood",
    description: "collects what the tide leaves behind",
    visibility: "public",
    archived: false,
    fork: false,
    language: "Python",
    pushedAt: ago(5),
    createdAt: ago(320),
    diskUsageKb: 6200,
    homepage: "https://driftwood.example.com",
    stars: 43,
    license: "MIT",
    topics: ["cli", "python"],
    openIssues: 0,
    openPRs: 0,
    hasReadme: true,
    defaultBranch: "main",
    lastCommit: { date: ago(5), message: "cache the tide table" },
    weeks: [2, 0, 0, 1, 4, 2, 1, 3],
    commits8w: 13,
    ci: "FAILURE",
  },
  {
    name: "tinderbox",
    description: null,
    visibility: "private",
    archived: false,
    fork: false,
    language: "Go",
    pushedAt: ago(9),
    createdAt: ago(60),
    diskUsageKb: 900,
    homepage: null,
    stars: 0,
    license: null,
    topics: [],
    openIssues: 0,
    openPRs: 0,
    hasReadme: true,
    defaultBranch: "main",
    lastCommit: { date: ago(9), message: "spike: the scheduler" },
    weeks: [0, 0, 0, 3, 6, 2, 0, 1],
    commits8w: 12,
    ci: null,
  },
  {
    name: "almanac",
    description: "every date the calendar refuses to explain",
    visibility: "public",
    archived: false,
    fork: false,
    language: "TypeScript",
    pushedAt: ago(16),
    createdAt: ago(410),
    diskUsageKb: 24_800,
    homepage: null,
    stars: 7,
    license: "MIT",
    topics: [],
    openIssues: 4,
    openPRs: 0,
    hasReadme: true,
    defaultBranch: "main",
    lastCommit: { date: ago(16), message: "leap seconds, again" },
    weeks: [1, 1, 0, 0, 2, 0, 0, 0],
    commits8w: 4,
    ci: "SUCCESS",
  },
  {
    name: "lanternfish",
    description: "a study in exponential growth",
    visibility: "public",
    archived: true,
    fork: false,
    language: "Rust",
    pushedAt: ago(240),
    createdAt: ago(600),
    diskUsageKb: 300,
    homepage: null,
    stars: 2,
    license: "MIT",
    topics: ["advent-of-code"],
    openIssues: 0,
    openPRs: 0,
    hasReadme: true,
    defaultBranch: "main",
    lastCommit: { date: ago(240), message: "day 6, finally" },
    weeks: [0, 0, 0, 0, 0, 0, 0, 0],
    commits8w: 0,
    ci: null,
  },
  {
    name: "semaphore",
    description: "flags, in both senses",
    visibility: "public",
    archived: false,
    fork: false,
    language: "TypeScript",
    pushedAt: ago(150),
    createdAt: ago(500),
    diskUsageKb: 1100,
    homepage: null,
    stars: 1,
    license: null,
    topics: [],
    openIssues: 1,
    openPRs: 0,
    hasReadme: false,
    defaultBranch: "main",
    lastCommit: { date: ago(150), message: "rename the middle flag" },
    weeks: [0, 0, 0, 0, 0, 0, 0, 0],
    commits8w: 0,
    ci: null,
  },
];

// ---------------------------------------------------------------- write

rmSync(root, { recursive: true, force: true });
mkdirSync(join(home, ".config", "shelf"), { recursive: true });
mkdirSync(join(home, ".cache", "shelf"), { recursive: true });
mkdirSync(reposDir, { recursive: true });

buildLocals();

// A TTL of a century means the demo never tries to reach GitHub, which it could
// not do anyway: the fake HOME has no gh config and no token.
await Bun.write(
  join(home, ".config", "shelf", "config.json"),
  JSON.stringify(
    {
      scanPaths: ["~/code"],
      scanDepth: 2,
      activeDays: 90,
      cacheTtlMinutes: 52_560_000,
      heavyMb: 20,
      exclude: [],
    },
    null,
    2,
  ) + "\n",
);

await Bun.write(
  join(home, ".cache", "shelf", "repos.json"),
  JSON.stringify({ fetchedAt: new Date(now).toISOString(), login: "nitrimandylis", repos }),
);

console.log(`fixture home: ${home}`);
console.log(`fixture repos: ${reposDir} (${locals.length})`);
