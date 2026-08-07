import {
  type Entry,
  type Tone,
  type AuditReport,
  STATE_MARK,
  lastActivity,
  ageDays,
  relTime,
  sparkline,
  localNote,
  humanSize,
} from "./model.ts";
import type { CommitLine } from "./github.ts";

// A view is one data model that both renderers consume. The terminal pads it;
// the browser serialises it to JSON and renders from that. Neither renderer
// knows anything about repos, which is what keeps them from drifting.
export type Cell = {
  text: string;
  tone?: Tone;
  href?: string;
  sort?: number | string; // renderers may sort on this instead of text
  bars?: number[]; // browser draws these as an SVG activity chart
  bigBars?: boolean; // draw the activity chart at detail size, not row size
};

export type Column = { label: string; align?: "left" | "right"; flex?: boolean; drop?: number };

/** `facets` are what the browser filters and groups on. The terminal ignores them. */
export type Row = { cells: Cell[]; facets?: Record<string, string> };

export type SectionKind = "table" | "lines" | "facts" | "timeline" | "markdown";

export type Section = {
  title?: string;
  note?: string;
  kind?: SectionKind;
  /** markdown sections only: server-rendered, safe-by-construction HTML. */
  html?: string;
  clean?: boolean; // a check that found nothing; browser renders it compactly
  columns?: Column[];
  rows: Row[];
};

export type Facet = { field: string; value: string; label: string; count: number; tone?: Tone };

export type GroupBy = { field: string; label: string };

export type View = {
  title: string;
  meta: string;
  warning?: string;
  sections: Section[];
  facets?: Facet[];
  groupBy?: GroupBy[];
};

const c = (text: string, tone?: Tone, extra: Partial<Cell> = {}): Cell => ({ text, tone, ...extra });

function ghUrl(name: string, login: string): string {
  return `https://github.com/${login}/${name}`;
}

// ---------------------------------------------------------------- triage

export type TriageOpts = {
  login: string;
  now: number;
  activeDays: number;
  showAll: boolean;
  meta: string;
  warning?: string;
};

function stateCell(e: Entry): Cell {
  // On a character grid the glyph IS the marker, in both renderers. No CSS dot
  // and no separate browser wording: one string, one alignment, one meaning.
  const mark = STATE_MARK[e.state];
  if (e.state === "synced") return c(`${mark} synced`, "good");
  if (e.state === "remote") return c(`${mark} remote`, "dim");
  return c(`${mark} local`, e.external ? "dim" : "warn");
}

function noteCell(e: Entry): Cell {
  const bits: string[] = [];
  let tone: Tone = "dim";

  if (e.state === "local" && !e.external) {
    bits.push("UNPUBLISHED");
    tone = "warn";
  }
  if (e.external) bits.push("clone");
  if (e.gh?.archived) bits.push("archived");
  if (e.gh?.visibility === "private") bits.push("private");

  const ln = localNote(e.local);
  if (ln && ln !== "clean") {
    bits.push(ln);
    if (tone === "dim") tone = "warn";
  }
  if (e.gh?.ci === "FAILURE") {
    bits.push("CI failing");
    tone = "bad";
  }
  return c(bits.join(" · "), tone);
}

function isDirty(e: Entry): boolean {
  return !!e.local && (e.local.dirty > 0 || e.local.ahead > 0);
}

function facetsFor(e: Entry, cold: boolean): Record<string, string> {
  return {
    state: e.state,
    lang: e.gh?.language ?? "none",
    temp: cold ? "cold" : "warm",
    vis: e.gh?.visibility ?? "unpublished",
    here: e.local ? "yes" : "no",
    unpublished: e.state === "local" && !e.external ? "yes" : "no",
    dirty: isDirty(e) ? "yes" : "no",
    archived: e.gh?.archived ? "yes" : "no",
  };
}

function triageRow(e: Entry, o: TriageOpts, cold: boolean): Row {
  const gh = e.gh;
  const activity = lastActivity(e);
  // GitHub's counts win when it has them; a local-only repo still gets a bar
  // from its own log rather than an empty column.
  const weeks = gh?.weeks ?? e.local?.weeks ?? [];
  const commits = gh?.commits8w ?? e.local?.commits8w ?? 0;

  return {
    facets: facetsFor(e, cold),
    cells: [
      c(e.name, e.gh?.archived ? "dim" : "accent", {
        href: gh ? ghUrl(e.name, o.login) : undefined,
        sort: e.name.toLowerCase(),
      }),
      c(gh?.language ?? "-", "dim"),
      c(relTime(activity, o.now), "plain", { sort: -activity }),
      c(weeks.length ? sparkline(weeks) : "        ", "accent", {
        sort: commits,
        bars: weeks.length ? weeks : undefined,
      }),
      c(commits ? String(commits) : "", "dim", { sort: commits }),
      c(gh?.openIssues ? String(gh.openIssues) : "", gh?.openIssues ? "warn" : "dim", {
        sort: gh?.openIssues ?? 0,
      }),
      stateCell(e),
      noteCell(e),
    ],
  };
}

function triageFacets(entries: Entry[], now: number, activeDays: number): Facet[] {
  const count = (fn: (e: Entry) => boolean) => entries.filter(fn).length;
  const cold = (e: Entry) => ageDays(lastActivity(e), now) > activeDays;

  const all: Facet[] = [
    { field: "here", value: "yes", label: "on this machine", count: count((e) => !!e.local) },
    {
      field: "unpublished",
      value: "yes",
      label: "unpublished",
      count: count((e) => e.state === "local" && !e.external),
      tone: "warn",
    },
    { field: "dirty", value: "yes", label: "uncommitted", count: count(isDirty), tone: "warn" },
    { field: "temp", value: "cold", label: "cold", count: count(cold), tone: "dim" },
    { field: "vis", value: "private", label: "private", count: count((e) => e.gh?.visibility === "private"), tone: "dim" },
    { field: "archived", value: "yes", label: "archived", count: count((e) => !!e.gh?.archived), tone: "dim" },
  ];
  return all.filter((f) => f.count > 0);
}

export function triageView(entries: Entry[], o: TriageOpts): View {
  const sorted = [...entries].sort((a, b) => lastActivity(b) - lastActivity(a));
  const isCold = (e: Entry) => ageDays(lastActivity(e), o.now) > o.activeDays;
  const warm = sorted.filter((e) => !isCold(e));
  const cold = sorted.filter(isCold);

  // drop priority: higher number disappears at a wider viewport. `note` never
  // drops — it carries UNPUBLISHED, dirty and failing-CI, which is the reason
  // to look at this table at all. It wraps instead, being the last column.
  const columns: Column[] = [
    { label: "repo" },
    { label: "lang", drop: 3 },
    { label: "age", align: "right" },
    { label: "8 weeks", drop: 1 },
    { label: "commits", align: "right", drop: 2 },
    { label: "iss", align: "right", drop: 3 },
    { label: "state" },
    { label: "note", flex: true },
  ];

  // Nothing at all is ambiguous between an empty account and a token that can
  // only see public repos, so say both rather than showing a bare header.
  if (!entries.length) {
    return {
      title: "SHELF",
      meta: o.meta,
      warning: o.warning,
      sections: [
        {
          kind: "lines",
          rows: [
            { cells: [c("No repos found.", "warn")] },
            { cells: [c("", "dim")] },
            { cells: [c("A token without repo scope only sees public repos.", "dim")] },
            { cells: [c("Check GITHUB_TOKEN, or run: gh auth login", "dim")] },
            { cells: [c("Local repos come from scanPaths in the config file.", "dim")] },
          ],
        },
      ],
    };
  }

  const sections: Section[] = [
    {
      kind: "table",
      columns,
      rows: (o.showAll ? sorted : warm).map((e) => triageRow(e, o, isCold(e))),
    },
  ];

  if (!o.showAll && cold.length) {
    sections.push({
      title: `cold (${cold.length})`,
      note: `untouched ${o.activeDays}d+ · --all to show`,
      kind: "lines",
      rows: [{ cells: [c(cold.map((e) => e.name).join("  "), "dim")] }],
    });
  }

  return {
    title: "SHELF",
    meta: o.meta,
    warning: o.warning,
    sections,
    facets: triageFacets(entries, o.now, o.activeDays),
    groupBy: [
      { field: "state", label: "state" },
      { field: "lang", label: "language" },
      { field: "temp", label: "activity" },
    ],
  };
}

// ---------------------------------------------------------------- audit

export function auditView(
  report: AuditReport,
  o: { meta: string; login: string; activeDays: number; heavyMb: number; warning?: string },
): View {
  const findingSection = (
    title: string,
    note: string,
    rows: { repo: string; detail: string; url?: string }[],
    tone: Tone,
  ): Section => {
    if (!rows.length) {
      return {
        title,
        note,
        kind: "lines",
        clean: true,
        rows: [{ cells: [c("✓ nothing", "good")] }],
      };
    }
    return {
      title: `${title} (${rows.length})`,
      note,
      kind: "table",
      columns: [{ label: "repo" }, { label: "detail", flex: true }],
      rows: rows.map((f) => ({
        facets: { check: title },
        cells: [
          c(f.repo, "accent", { href: f.url ?? ghUrl(f.repo, o.login) }),
          c(f.detail, tone),
        ],
      })),
    };
  };

  return {
    title: "SHELF AUDIT",
    meta: o.meta,
    warning: o.warning,
    sections: [
      findingSection(
        "hygiene",
        `public repos missing description, README, license or topics · ${report.skippedPrivate} private skipped`,
        report.hygiene,
        "warn",
      ),
      findingSection(
        "stale, not archived",
        `no push in ${o.activeDays}d and still open for business`,
        report.stale,
        "warn",
      ),
      findingSection("dead links", "homepageUrl targets that did not answer 2xx", report.deadLinks, "bad"),
      findingSection("heavy", `over ${o.heavyMb}MB — usually committed binaries`, report.heavy, "warn"),
      findingSection("unpublished", "on this machine only, no remote", report.unpublished, "warn"),
    ],
  };
}

// ---------------------------------------------------------------- show

export type ShowExtras = {
  readmeHtml?: string | null;
  languages?: { name: string; pct: number }[];
  latestRelease?: { tag: string; publishedAt: string } | null;
};

export function showView(
  e: Entry,
  commits: CommitLine[],
  o: { login: string; now: number; meta: string; commitError?: string },
  extra: ShowExtras = {},
): View {
  const gh = e.gh;
  const sections: Section[] = [];

  const facts: Row[] = [];
  const fact = (k: string, v: string, tone: Tone = "plain", href?: string) =>
    facts.push({ cells: [c(k, "dim"), c(v, tone, { href })] });

  if (gh) {
    fact("visibility", gh.visibility + (gh.archived ? " · archived" : ""), gh.archived ? "warn" : "plain");
    fact("language", gh.language ?? "-");
    fact("size", humanSize(gh.diskUsageKb));
    fact("license", gh.license ?? "none", gh.license ? "plain" : "warn");
    fact("created", gh.createdAt.slice(0, 10));
    fact("pushed", `${relTime(Date.parse(gh.pushedAt), o.now)} ago`);
    fact("topics", gh.topics.length ? gh.topics.join(" ") : "none", gh.topics.length ? "plain" : "warn");
    fact("open", `${gh.openIssues} issues · ${gh.openPRs} PRs`);
    fact("stars", String(gh.stars));
    if (extra.languages?.length) {
      fact("makeup", extra.languages.map((l) => `${l.name} ${l.pct}%`).join("  "));
    }
    if (extra.latestRelease) {
      fact("release", `${extra.latestRelease.tag} · ${extra.latestRelease.publishedAt.slice(0, 10)}`);
    }
    if (gh.ci) fact("CI", gh.ci, gh.ci === "SUCCESS" ? "good" : gh.ci === "FAILURE" ? "bad" : "warn");
    fact("url", ghUrl(gh.name, o.login), "plain", ghUrl(gh.name, o.login));
    if (gh.homepage) fact("homepage", gh.homepage, "plain", gh.homepage);
  }

  if (e.local) {
    const l = e.local;
    fact("local", l.path, "good");
    fact("branch", `${l.branch ?? "(detached)"}${l.upstream ? ` → ${l.upstream}` : " (no upstream)"}`);
    fact("worktree", localNote(l), l.dirty || l.ahead ? "warn" : "good");
  } else if (gh) {
    fact("local", "not cloned", "dim");
  }

  // The activity chart is its own section so the browser can give it room
  // instead of squeezing it into a two-column fact list.
  const weeks = gh?.weeks ?? e.local?.weeks ?? [];
  const commits8w = gh?.commits8w ?? e.local?.commits8w ?? 0;
  if (weeks.length) {
    sections.push({
      title: "activity",
      note: `${commits8w} commits in 8 weeks${gh ? "" : " (local log)"}`,
      kind: "table",
      columns: [{ label: "" }, { label: "", flex: true }],
      rows: [
        {
          cells: [
            c(sparkline(weeks), "accent", { bars: weeks, bigBars: true }),
            c(`${commits8w} commits`, "dim"),
          ],
        },
      ],
    });
  }

  sections.unshift({
    title: `${e.name}${gh?.description ? " — " + gh.description : ""}`,
    kind: "facts",
    columns: [{ label: "" }, { label: "", flex: true }],
    rows: facts,
  });

  if (o.commitError) {
    sections.push({ title: "recent", kind: "lines", rows: [{ cells: [c(o.commitError, "warn")] }] });
  } else if (commits.length) {
    sections.push({
      title: "recent",
      kind: "timeline",
      columns: [{ label: "when", align: "right" }, { label: "commit", flex: true }],
      rows: commits.map((k) => ({
        cells: [c(relTime(Date.parse(k.date), o.now), "dim"), c(k.message)],
      })),
    });
  }

  if (extra.readmeHtml) {
    sections.push({ title: "readme", kind: "markdown", html: extra.readmeHtml, rows: [] });
  } else if (extra.readmeHtml === null) {
    sections.push({
      title: "readme",
      kind: "lines",
      rows: [{ cells: [c("no README in this repo", "dim")] }],
    });
  }

  return { title: `SHELF · ${e.name}`, meta: o.meta, sections };
}

// ---------------------------------------------------------------- index

export function indexView(entries: Entry[], o: { login: string; meta: string; now: number }): View {
  const pub = entries
    .filter((e) => e.gh && e.gh.visibility === "public" && !e.gh.fork)
    .map((e) => e.gh!);

  const groups = new Map<string, typeof pub>();
  for (const r of pub) {
    const k = r.language ?? "Other";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  const ordered = [...groups.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[0].localeCompare(b[0]);
  });

  const sections: Section[] = ordered.map(([lang, repos]) => ({
    title: `${lang} (${repos.length})`,
    kind: "table",
    columns: [{ label: "repo" }, { label: "what it is", flex: true }, { label: "updated", align: "right" }],
    rows: repos
      .sort((a, b) => Date.parse(b.pushedAt) - Date.parse(a.pushedAt))
      .map((r) => ({
        facets: { lang },
        cells: [
          c(r.name, "accent", { href: ghUrl(r.name, o.login) }),
          c(r.description ?? "", "plain"),
          c(relTime(Date.parse(r.pushedAt), o.now), "dim", { sort: -Date.parse(r.pushedAt) }),
        ],
      })),
  }));

  return {
    title: "ALL REPOS",
    meta: `${pub.length} public · ${o.meta}`,
    sections,
  };
}
