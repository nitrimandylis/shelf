import { test, expect, describe } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  mergeEntries,
  sparkline,
  relTime,
  displayWidth,
  truncate,
  padTo,
  humanSize,
  localNote,
  lastActivity,
  ageDays,
  auditOffline,
  weekBuckets,
  type Repo,
  type LocalRepo,
} from "./model.ts";
import { parseStatus, parseRemote, findRepos } from "./local.ts";
import { parseArgs } from "./shelf.ts";
import { triageView, auditView, indexView, showView } from "./views.ts";
import { renderView } from "./term.ts";
import { renderHtml, jsonScript } from "./html.ts";

// ---------------------------------------------------------------- fixtures

const NOW = Date.parse("2026-08-06T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

function repo(over: Partial<Repo> = {}): Repo {
  const weeks = over.weeks ?? [0, 0, 0, 0, 0, 0, 0, 0];
  return {
    name: "demo",
    description: "a demo repo",
    visibility: "public",
    archived: false,
    fork: false,
    language: "TypeScript",
    pushedAt: ago(1),
    createdAt: ago(100),
    diskUsageKb: 500,
    homepage: null,
    stars: 0,
    license: "MIT",
    topics: ["cli"],
    openIssues: 0,
    openPRs: 0,
    hasReadme: true,
    defaultBranch: "main",
    lastCommit: { date: ago(1), message: "do a thing" },
    weeks,
    commits8w: weeks.reduce((a, b) => a + b, 0),
    ci: null,
    ...over,
  };
}

function local(over: Partial<LocalRepo> = {}): LocalRepo {
  return {
    name: "demo",
    path: "/Users/x/cc/demo",
    branch: "main",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    dirty: 0,
    remoteOwner: "nitrimandylis",
    remoteName: "demo",
    lastCommitAt: ago(1),
    weeks: [0, 0, 0, 0, 0, 0, 0, 0],
    commits8w: 0,
    ...over,
  };
}

// ---------------------------------------------------------------- git parsing

describe("parseStatus", () => {
  test("reads branch, upstream, ahead/behind and dirty count", () => {
    const out = parseStatus(
      [
        "# branch.oid abc123",
        "# branch.head main",
        "# branch.upstream origin/main",
        "# branch.ab +2 -1",
        "1 .M N... 100644 100644 100644 aaa bbb file.ts",
        "? untracked.txt",
        "2 R. N... 100644 100644 100644 ccc ddd R100 new.ts\told.ts",
      ].join("\n"),
    );
    expect(out).toEqual({ branch: "main", upstream: "origin/main", ahead: 2, behind: 1, dirty: 3 });
  });

  test("clean repo has no dirty entries", () => {
    const out = parseStatus("# branch.oid abc\n# branch.head main\n# branch.ab +0 -0\n");
    expect(out.dirty).toBe(0);
    expect(out.ahead).toBe(0);
  });

  test("detached HEAD has a null branch", () => {
    expect(parseStatus("# branch.head (detached)\n").branch).toBeNull();
  });

  test("no upstream leaves ahead/behind at zero", () => {
    const out = parseStatus("# branch.head wip\n? a.txt\n");
    expect(out.upstream).toBeNull();
    expect(out.ahead).toBe(0);
    expect(out.dirty).toBe(1);
  });

  test("comment lines are never counted as changes", () => {
    expect(parseStatus("# branch.head main\n# branch.ab +9 -9\n").dirty).toBe(0);
  });
});

describe("parseRemote", () => {
  test.each([
    ["git@github.com:nitrimandylis/swatch.git", "nitrimandylis", "swatch"],
    ["https://github.com/nitrimandylis/swatch.git", "nitrimandylis", "swatch"],
    ["https://github.com/nitrimandylis/swatch", "nitrimandylis", "swatch"],
    ["ssh://git@github.com/nitrimandylis/swatch.git", "nitrimandylis", "swatch"],
    ["git@gitlab.com:someone/thing.git", "someone", "thing"],
  ])("parses %s", (url, owner, name) => {
    expect(parseRemote(url)).toEqual({ owner, name });
  });

  test("returns null for junk", () => {
    expect(parseRemote("")).toBeNull();
    expect(parseRemote("not a url")).toBeNull();
  });

  test("keeps a dot inside the repo name", () => {
    expect(parseRemote("git@github.com:nitrimandylis/Petal.AI.git")).toEqual({
      owner: "nitrimandylis",
      name: "Petal.AI",
    });
  });
});

describe("findRepos", () => {
  test("finds nested repos and skips node_modules", () => {
    const root = mkdtempSync(join(tmpdir(), "shelf-test-"));
    try {
      for (const p of ["a/.git", "b/c/.git", "b/.git", "node_modules/pkg/.git", "deep/x/y/.git"]) {
        mkdirSync(join(root, p), { recursive: true });
      }
      const found = findRepos([root], 2).map((p) => p.slice(root.length + 1)).sort();
      expect(found).toEqual(["a", "b", "b/c"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a missing root is skipped, not an error", () => {
    expect(findRepos(["/definitely/not/here"], 2)).toEqual([]);
  });

  test("a git file (worktree/submodule) counts as a repo", () => {
    const root = mkdtempSync(join(tmpdir(), "shelf-test-"));
    try {
      mkdirSync(join(root, "wt"), { recursive: true });
      writeFileSync(join(root, "wt", ".git"), "gitdir: /elsewhere\n");
      expect(findRepos([root], 2).map((p) => p.slice(root.length + 1))).toEqual(["wt"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------- merge

describe("mergeEntries", () => {
  test("matches a clone to its GitHub repo by origin, not by name", () => {
    const entries = mergeEntries(
      [repo({ name: "swatch" })],
      [local({ name: "swatch", remoteName: "swatch" })],
      "nitrimandylis",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.state).toBe("synced");
    expect(entries[0]!.local).not.toBeNull();
  });

  test("a same-named local repo with no remote stays unpublished", () => {
    const entries = mergeEntries(
      [repo({ name: "nous" })],
      [local({ name: "nous", remoteOwner: null, remoteName: null })],
      "nitrimandylis",
    );
    expect(entries.map((e) => e.state).sort()).toEqual(["local", "remote"]);
    expect(entries.find((e) => e.state === "remote")!.local).toBeNull();
  });

  test("a clone of someone else's repo is local and external", () => {
    const entries = mergeEntries([], [local({ name: "bun", remoteOwner: "oven-sh", remoteName: "bun" })], "nitrimandylis");
    expect(entries[0]!.state).toBe("local");
    expect(entries[0]!.external).toBe(true);
  });

  test("a GitHub repo that is not cloned is remote", () => {
    const entries = mergeEntries([repo({ name: "Starspace" })], [], "nitrimandylis");
    expect(entries[0]!.state).toBe("remote");
    expect(entries[0]!.local).toBeNull();
  });

  test("owner matching is case-insensitive", () => {
    const entries = mergeEntries(
      [repo({ name: "Petal.AI" })],
      [local({ name: "petal", remoteOwner: "NitriMandylis", remoteName: "petal.ai" })],
      "nitrimandylis",
    );
    expect(entries[0]!.state).toBe("synced");
  });

  test("one local clone is never claimed by two repos", () => {
    const l = local({ name: "swatch", remoteName: "swatch" });
    const entries = mergeEntries([repo({ name: "swatch" }), repo({ name: "other" })], [l], "nitrimandylis");
    expect(entries.filter((e) => e.local === l)).toHaveLength(1);
    expect(entries).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- formatting

describe("sparkline", () => {
  test("zero weeks are the flat baseline", () => {
    expect(sparkline([0, 0, 0, 0, 0, 0, 0, 0])).toBe("▁▁▁▁▁▁▁▁");
  });

  test("any activity rises above the baseline", () => {
    const s = sparkline([0, 1, 0, 0, 0, 0, 0, 100]);
    expect(s[0]).toBe("▁");
    expect(s[1]).not.toBe("▁");
    expect(s[7]).toBe("█");
  });

  test("scales to the repo's own max", () => {
    expect(sparkline([1, 2])).toBe(sparkline([50, 100]));
  });

  test("keeps one cell per week", () => {
    expect([...sparkline([1, 2, 3, 4, 5, 6, 7, 8])]).toHaveLength(8);
  });
});

describe("weekBuckets", () => {
  test("puts commits in the right trailing week, newest last", () => {
    const dates = [ago(0.5), ago(1), ago(8), ago(70)];
    const b = weekBuckets(dates, NOW);
    expect(b).toHaveLength(8);
    expect(b[7]).toBe(2); // this week
    expect(b[6]).toBe(1); // last week
    expect(b.reduce((a, c) => a + c, 0)).toBe(3); // 70d ago is outside the 56d window
  });

  test("ignores junk and future dates", () => {
    expect(weekBuckets(["not-a-date", new Date(NOW + 86_400_000).toISOString()], NOW).reduce((a, c) => a + c, 0)).toBe(0);
  });

  test("no commits is all zeros, not an empty array", () => {
    expect(weekBuckets([], NOW)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("relTime", () => {
  test.each([
    [0.5, "12h"],
    [3, "3d"],
    [20, "2w"],
    [100, "3mo"],
    [800, "2y"],
  ])("%p days ago reads as %p", (days, want) => {
    expect(relTime(NOW - days * 86_400_000, NOW)).toBe(want);
  });

  test("unknown time is a dash, not a fake date", () => {
    expect(relTime(0, NOW)).toBe("-");
    expect(relTime(NaN, NOW)).toBe("-");
  });

  test("never renders a negative age", () => {
    expect(relTime(NOW + 60_000, NOW)).toBe("now");
  });
});

describe("width helpers", () => {
  test("ANSI escapes take no cells", () => {
    expect(displayWidth("\x1b[31mred\x1b[0m")).toBe(3);
  });

  test("wide characters take two cells", () => {
    expect(displayWidth("日本")).toBe(4);
  });

  test("sparkline blocks are single width", () => {
    expect(displayWidth("▇▇▂▁")).toBe(4);
  });

  test("truncate respects the budget and marks the cut", () => {
    expect(displayWidth(truncate("abcdefghij", 5))).toBe(5);
    expect(truncate("abcdefghij", 5).endsWith("…")).toBe(true);
    expect(truncate("abc", 5)).toBe("abc");
  });

  test("padTo fills to exactly the width", () => {
    expect(padTo("ab", 5)).toBe("ab   ");
    expect(padTo("ab", 5, "right")).toBe("   ab");
    expect(displayWidth(padTo("日本", 6))).toBe(6);
  });
});

test("humanSize steps units", () => {
  expect(humanSize(500)).toBe("500KB");
  expect(humanSize(29466)).toBe("29MB");
  expect(humanSize(1536)).toBe("1.5MB");
});

describe("localNote", () => {
  test("clean is clean", () => {
    expect(localNote(local())).toBe("clean");
  });
  test("counts are spelled out", () => {
    expect(localNote(local({ dirty: 2, ahead: 1 }))).toBe("2 dirty 1 ahead");
  });
  test("no clone has no note", () => {
    expect(localNote(null)).toBe("");
  });
});

describe("lastActivity", () => {
  test("takes the newer of GitHub push and local commit", () => {
    const e = mergeEntries(
      [repo({ name: "x", pushedAt: ago(10) })],
      [local({ name: "x", remoteName: "x", lastCommitAt: ago(2) })],
      "nitrimandylis",
    )[0]!;
    expect(lastActivity(e)).toBe(Date.parse(ago(2)));
  });

  test("a local-only repo still has activity", () => {
    const e = mergeEntries([], [local({ name: "deck", remoteOwner: null, remoteName: null, lastCommitAt: ago(3) })], "n")[0]!;
    expect(ageDays(lastActivity(e), NOW)).toBeCloseTo(3, 1);
  });

  test("no dates at all is treated as infinitely old", () => {
    const e = mergeEntries([], [local({ remoteOwner: null, remoteName: null, lastCommitAt: null })], "n")[0]!;
    expect(ageDays(lastActivity(e), NOW)).toBe(Infinity);
  });
});

// ---------------------------------------------------------------- audit

describe("auditOffline", () => {
  const opts = { activeDays: 90, heavyMb: 20 };

  test("flags a public repo missing everything", () => {
    const e = mergeEntries(
      [repo({ name: "bare", description: null, hasReadme: false, license: null, topics: [] })],
      [],
      "n",
    );
    const r = auditOffline(e, NOW, opts);
    expect(r.hygiene).toHaveLength(1);
    expect(r.hygiene[0]!.detail).toBe("no description, no README, no license, no topics");
  });

  test("private repos are skipped and counted, not reported", () => {
    const e = mergeEntries([repo({ visibility: "private", topics: [], hasReadme: false })], [], "n");
    const r = auditOffline(e, NOW, opts);
    expect(r.hygiene).toEqual([]);
    expect(r.skippedPrivate).toBe(1);
  });

  test("a clean public repo produces nothing", () => {
    const r = auditOffline(mergeEntries([repo()], [], "n"), NOW, opts);
    expect(r.hygiene).toEqual([]);
    expect(r.stale).toEqual([]);
    expect(r.heavy).toEqual([]);
  });

  test("stale means old and still open for business", () => {
    const e = mergeEntries(
      [
        repo({ name: "old", pushedAt: ago(200) }),
        repo({ name: "oldArchived", pushedAt: ago(200), archived: true }),
        repo({ name: "oldFork", pushedAt: ago(200), fork: true }),
        repo({ name: "fresh", pushedAt: ago(5) }),
      ],
      [],
      "n",
    );
    expect(auditOffline(e, NOW, opts).stale.map((f) => f.repo)).toEqual(["old"]);
  });

  test("heavy uses the configured threshold", () => {
    const e = mergeEntries([repo({ name: "big", diskUsageKb: 35_000 })], [], "n");
    expect(auditOffline(e, NOW, opts).heavy[0]!.detail).toBe("34MB");
    expect(auditOffline(e, NOW, { ...opts, heavyMb: 100 }).heavy).toEqual([]);
  });

  test("unpublished counts local-only repos but not other people's clones", () => {
    const e = mergeEntries(
      [],
      [
        local({ name: "deck", remoteOwner: null, remoteName: null }),
        local({ name: "bun", remoteOwner: "oven-sh", remoteName: "bun" }),
      ],
      "nitrimandylis",
    );
    expect(auditOffline(e, NOW, opts).unpublished.map((f) => f.repo)).toEqual(["deck"]);
  });

  test("every list is an array when nothing is wrong", () => {
    const r = auditOffline([], NOW, opts);
    expect(r.hygiene).toEqual([]);
    expect(r.stale).toEqual([]);
    expect(r.heavy).toEqual([]);
    expect(r.unpublished).toEqual([]);
  });
});

// ---------------------------------------------------------------- args

describe("parseArgs", () => {
  test("bare invocation is triage", () => {
    expect(parseArgs([]).cmd).toBe("triage");
  });

  test("--json is a flag, never a positional argument", () => {
    const { cmd, args, flags } = parseArgs(["show", "--json", "swatch"]);
    expect(cmd).toBe("show");
    expect(args).toEqual(["swatch"]);
    expect(flags.json).toBe(true);
  });

  test("flags work before the command too", () => {
    const { cmd, flags } = parseArgs(["--json", "audit"]);
    expect(cmd).toBe("audit");
    expect(flags.json).toBe(true);
  });

  test("-o takes the next argument", () => {
    const { flags, args } = parseArgs(["index", "-o", "out.html"]);
    expect(flags.out).toBe("out.html");
    expect(args).toEqual([]);
  });

  test("-o with nothing after it is an error", () => {
    expect(() => parseArgs(["index", "-o"])).toThrow(/needs a file path/);
  });

  test("an unknown option is an error, not silently ignored", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/unknown option/);
  });

  test("negatable flags default on", () => {
    expect(parseArgs([]).flags.open).toBe(true);
    expect(parseArgs(["--no-open"]).flags.open).toBe(false);
    expect(parseArgs(["--no-links"]).flags.links).toBe(false);
  });
});

// ---------------------------------------------------------------- rendering

const viewOpts = { login: "nitrimandylis", now: NOW, activeDays: 90, showAll: false, meta: "test" };

describe("triageView", () => {
  const entries = mergeEntries(
    [
      repo({ name: "warm", pushedAt: ago(1), weeks: [0, 0, 1, 2, 3, 4, 5, 6] }),
      repo({ name: "chilly", pushedAt: ago(200) }),
    ],
    [local({ name: "warm", remoteName: "warm" })],
    "nitrimandylis",
  );

  test("cold repos collapse into a named section", () => {
    const v = triageView(entries, viewOpts);
    expect(v.sections[0]!.rows).toHaveLength(1);
    expect(v.sections[1]!.title).toBe("cold (1)");
    expect(v.sections[1]!.rows[0]!.cells[0]!.text).toContain("chilly");
  });

  test("--all puts everything in one table", () => {
    const v = triageView(entries, { ...viewOpts, showAll: true });
    expect(v.sections).toHaveLength(1);
    expect(v.sections[0]!.rows).toHaveLength(2);
  });

  test("rows are sorted newest activity first", () => {
    const v = triageView(entries, { ...viewOpts, showAll: true });
    expect(v.sections[0]!.rows.map((r) => r.cells[0]!.text)).toEqual(["warm", "chilly"]);
  });

  test("an unpublished repo is called out in the note column", () => {
    const e = mergeEntries([], [local({ name: "deck", remoteOwner: null, remoteName: null })], "nitrimandylis");
    const note = triageView(e, viewOpts).sections[0]!.rows[0]!.cells[7]!;
    expect(note.text).toContain("UNPUBLISHED");
    expect(note.tone).toBe("warn");
  });

  test("a local-only repo gets a sparkline from its own log", () => {
    const e = mergeEntries(
      [],
      [local({ name: "deck", remoteOwner: null, remoteName: null, weeks: [0, 0, 0, 1, 2, 0, 0, 4], commits8w: 7 })],
      "nitrimandylis",
    );
    const row = triageView(e, viewOpts).sections[0]!.rows[0]!;
    expect(row.cells[3]!.text).not.toMatch(/^ +$/);
    expect(row.cells[4]!.text).toBe("7");
  });

  test("GitHub counts win over local ones when both exist", () => {
    const e = mergeEntries(
      [repo({ name: "x", weeks: [9, 0, 0, 0, 0, 0, 0, 0], commits8w: 9 })],
      [local({ name: "x", remoteName: "x", weeks: [0, 0, 0, 0, 0, 0, 0, 1], commits8w: 1 })],
      "nitrimandylis",
    );
    expect(triageView(e, viewOpts).sections[0]!.rows[0]!.cells[4]!.text).toBe("9");
  });

  test("facets count what the chips claim", () => {
    const e = mergeEntries(
      [repo({ name: "pub" }), repo({ name: "priv", visibility: "private" }), repo({ name: "old", pushedAt: ago(200) })],
      [local({ name: "deck", remoteOwner: null, remoteName: null }), local({ name: "pub", remoteName: "pub", dirty: 2 })],
      "nitrimandylis",
    );
    const facets = triageView(e, viewOpts).facets!;
    const byLabel = Object.fromEntries(facets.map((f) => [f.label, f.count]));
    expect(byLabel["unpublished"]).toBe(1);
    expect(byLabel["uncommitted"]).toBe(1);
    expect(byLabel["private"]).toBe(1);
    expect(byLabel["cold"]).toBe(1);
    expect(byLabel["on this machine"]).toBe(2);
  });

  test("a facet with a zero count is not offered as a chip", () => {
    const e = mergeEntries([repo()], [], "n");
    const labels = triageView(e, viewOpts).facets!.map((f) => f.label);
    expect(labels).not.toContain("unpublished");
    expect(labels).not.toContain("archived");
  });

  test("every row carries the facets the chips filter on", () => {
    const e = mergeEntries([repo({ name: "x" })], [], "n");
    const f = triageView(e, viewOpts).sections[0]!.rows[0]!.facets!;
    expect(f.state).toBe("remote");
    expect(f.temp).toBe("warm");
    expect(f.unpublished).toBe("no");
  });

  test("the activity cell carries raw weeks for the SVG, not just glyphs", () => {
    const weeks = [0, 1, 2, 3, 4, 5, 6, 7];
    const e = mergeEntries([repo({ weeks, commits8w: 28 })], [], "n");
    const cell = triageView(e, viewOpts).sections[0]!.rows[0]!.cells[3]!;
    expect(cell.bars).toEqual(weeks);
    expect(cell.text.length).toBe(8); // terminal still gets its glyphs
  });

  test("a repo with no activity data has no bars to draw", () => {
    const e = mergeEntries([], [local({ remoteOwner: null, remoteName: null, weeks: [] })], "n");
    expect(triageView(e, viewOpts).sections[0]!.rows[0]!.cells[3]!.bars).toBeUndefined();
  });

  test("the note column never drops: it carries the reason to look", () => {
    const cols = triageView(mergeEntries([repo()], [], "n"), viewOpts).sections[0]!.columns!;
    const note = cols.find((c) => c.label === "note")!;
    const state = cols.find((c) => c.label === "state")!;
    const repoCol = cols.find((c) => c.label === "repo")!;
    // undefined drop == never hidden at any breakpoint
    expect(note.drop).toBeUndefined();
    expect(state.drop).toBeUndefined();
    expect(repoCol.drop).toBeUndefined();
    // and the low-value columns do drop, highest number first
    expect(cols.find((c) => c.label === "lang")!.drop).toBe(3);
    expect(cols.find((c) => c.label === "iss")!.drop).toBe(3);
  });

  test("group-by fields all exist as row facets", () => {
    const e = mergeEntries([repo()], [], "n");
    const view = triageView(e, viewOpts);
    const facetKeys = Object.keys(view.sections[0]!.rows[0]!.facets!);
    for (const g of view.groupBy!) expect(facetKeys).toContain(g.field);
  });

  test("a failing CI run is surfaced as bad", () => {
    const e = mergeEntries([repo({ ci: "FAILURE" })], [], "n");
    expect(triageView(e, viewOpts).sections[0]!.rows[0]!.cells[7]!.tone).toBe("bad");
  });
});

describe("section kinds", () => {
  test("a clean audit check is flagged so the browser can collapse it", () => {
    const view = auditView(
      { hygiene: [], stale: [{ repo: "old", detail: "200d" }], heavy: [], unpublished: [], deadLinks: [], skippedPrivate: 3 },
      { meta: "t", login: "n", activeDays: 90, heavyMb: 20 },
    );
    const clean = view.sections.filter((s) => s.clean);
    expect(clean).toHaveLength(4);
    expect(view.sections.find((s) => s.title?.startsWith("stale"))!.clean).toBeUndefined();
  });

  test("show uses facts and timeline kinds, not a reused table", () => {
    const e = mergeEntries([repo({ name: "swatch", weeks: [1, 0, 0, 0, 0, 0, 0, 2] })], [], "n");
    const view = showView(e[0]!, [{ date: ago(1), message: "do a thing" }], {
      login: "n",
      now: NOW,
      meta: "t",
    });
    const kinds = view.sections.map((s) => s.kind);
    expect(kinds).toContain("facts");
    expect(kinds).toContain("timeline");
    // the activity chart gets its own section with real bars
    const act = view.sections.find((s) => s.title === "activity")!;
    expect(act.rows[0]!.cells[0]!.bars).toEqual([1, 0, 0, 0, 0, 0, 0, 2]);
  });

  test("a commit-fetch failure degrades to a line, not a broken timeline", () => {
    const e = mergeEntries([repo()], [], "n");
    const view = showView(e[0]!, [], { login: "n", now: NOW, meta: "t", commitError: "boom" });
    const last = view.sections[view.sections.length - 1]!;
    expect(last.kind).toBe("lines");
    expect(last.rows[0]!.cells[0]!.text).toContain("boom");
  });
});

describe("renderView", () => {
  const entries = mergeEntries([repo({ name: "swatch", openIssues: 3 })], [], "nitrimandylis");
  const v = triageView(entries, viewOpts);

  test("emits no escape codes when colour is off", () => {
    expect(renderView(v, { width: 100, color: false })).not.toContain("\x1b[");
  });

  test("emits escape codes when colour is on", () => {
    expect(renderView(v, { width: 100, color: true })).toContain("\x1b[");
  });

  test("never exceeds the given width", () => {
    for (const width of [40, 60, 80, 120, 200]) {
      const lines = renderView(v, { width, color: false }).split("\n");
      for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  test("leaves no trailing whitespace, coloured or not", () => {
    for (const color of [true, false]) {
      for (const line of renderView(v, { width: 100, color }).split("\n")) {
        expect(line.replace(/\x1b\[[0-9;]*m/g, "")).not.toMatch(/[ \t]+$/);
      }
    }
  });

  test("keeps the data visible at a normal width", () => {
    const out = renderView(v, { width: 100, color: false });
    expect(out).toContain("swatch");
    expect(out).toContain("SHELF");
  });

  test("renders an audit with empty sections as ticks", () => {
    const view = auditView(
      { hygiene: [], stale: [], heavy: [], unpublished: [], deadLinks: [], skippedPrivate: 8 },
      { meta: "test", login: "n", activeDays: 90, heavyMb: 20 },
    );
    const out = renderView(view, { width: 100, color: false });
    expect(out.match(/✓ nothing/g)).toHaveLength(5);
    expect(out).toContain("8 private skipped");
  });
});

// Pull the embedded view model back out of the page, the way the browser does.
function payloadOf(html: string): any {
  const m = html.match(/<script type="application\/json" id="shelf-data">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no shelf-data payload in page");
  return JSON.parse(m[1]!);
}

describe("renderHtml", () => {
  const v = indexView(mergeEntries([repo({ name: "swatch" })], [], "nitrimandylis"), {
    login: "nitrimandylis",
    meta: "test",
    now: NOW,
  });

  test("is one self-contained document with no external requests", () => {
    const html = renderHtml(v);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)="https?:/);
  });

  test("neutralises markup in the embedded data payload", () => {
    const nasty = indexView(
      mergeEntries(
        [repo({ name: "x", description: `</script><img onerror="alert(1)">& "quoted"` })],
        [],
        "n",
      ),
      { login: "n", meta: "t", now: NOW },
    );
    const html = renderHtml(nasty);
    // The payload must not be able to close its own script tag.
    expect(html).not.toContain("</script><img");
    expect(html).toContain("\\u003c/script");
    // Exactly two script tags: the JSON payload and the renderer.
    expect(html.match(/<script/g)).toHaveLength(2);
  });

  test("jsonScript escapes angle brackets and line separators", () => {
    expect(jsonScript({ a: "</script>" })).not.toContain("</script>");
    expect(jsonScript({ a: "\u2028\u2029" })).not.toMatch(/[\u2028\u2029]/);
    // still valid JSON, and the escapes survive a parse back to the original
    expect(JSON.parse(jsonScript({ a: "</script>\u2028x" }))).toEqual({ a: "</script>\u2028x" });
  });

  test("the payload round-trips to the same view", () => {
    const back = payloadOf(renderHtml(v));
    expect(back.title).toBe(v.title);
    expect(back.sections[0].rows.length).toBe(v.sections[0]!.rows.length);
    expect(back.sections[0].columns.length).toBe(v.sections[0]!.columns!.length);
  });

  test("the refresh button only exists when something can serve it", () => {
    const live = renderHtml(v, { refreshable: true });
    expect(live).toContain('id="refresh"');
    expect(live).toContain('data-url="/api/data?refresh=1"');
    const stat = renderHtml(v, { refreshable: false });
    expect(stat).not.toContain('id="refresh"');
    expect(stat).not.toContain("refresh=1");
  });

  test("static export is still self-contained and inert", () => {
    const stat = renderHtml(v, { refreshable: false });
    expect(stat).not.toMatch(/<(script|link|img)[^>]+(src|href)="https?:/);
    expect(stat).toContain("shelf-data");
  });

  test("carries numeric sort keys so the client sorts on values, not text", () => {
    const back = payloadOf(renderHtml(v));
    const updated = back.sections[0].rows[0].cells[2];
    expect(typeof updated.sort).toBe("number");
  });

  test("private repos never reach the public index", () => {
    const mixed = indexView(
      mergeEntries([repo({ name: "pub" }), repo({ name: "secret", visibility: "private" })], [], "n"),
      { login: "n", meta: "t", now: NOW },
    );
    const html = renderHtml(mixed);
    expect(html).toContain("pub");
    expect(html).not.toContain("secret");
  });
});
