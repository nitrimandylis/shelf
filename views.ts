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

// A view is one data model that both renderers consume. The terminal pads it,
// the HTML page tabulates it; neither knows anything about repos.
export type Cell = {
  text: string;
  tone?: Tone;
  href?: string;
  sort?: number | string; // renderers may sort on this instead of text
};

export type Column = { label: string; align?: "left" | "right"; flex?: boolean };

export type Row = { cells: Cell[] };

export type Section = {
  title?: string;
  note?: string;
  columns?: Column[]; // absent = render rows as plain lines
  rows: Row[];
};

export type View = {
  title: string;
  meta: string;
  warning?: string;
  sections: Section[];
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

function triageRow(e: Entry, o: TriageOpts): Row {
  const gh = e.gh;
  const activity = lastActivity(e);
  // GitHub's counts win when it has them; a local-only repo still gets a bar
  // from its own log rather than an empty column.
  const weeks = gh?.weeks ?? e.local?.weeks ?? [];
  const commits = gh?.commits8w ?? e.local?.commits8w ?? 0;

  return {
    cells: [
      c(e.name, e.gh?.archived ? "dim" : "accent", {
        href: gh ? ghUrl(e.name, o.login) : undefined,
        sort: e.name.toLowerCase(),
      }),
      c(gh?.language ?? "-", "dim"),
      c(relTime(activity, o.now), "plain", { sort: -activity }),
      c(weeks.length ? sparkline(weeks) : "        ", "accent", { sort: commits }),
      c(commits ? String(commits) : "", "dim", { sort: commits }),
      c(gh?.openIssues ? String(gh.openIssues) : "", gh?.openIssues ? "warn" : "dim", {
        sort: gh?.openIssues ?? 0,
      }),
      stateCell(e),
      noteCell(e),
    ],
  };
}

export function triageView(entries: Entry[], o: TriageOpts): View {
  const sorted = [...entries].sort((a, b) => lastActivity(b) - lastActivity(a));
  const warm = sorted.filter((e) => ageDays(lastActivity(e), o.now) <= o.activeDays);
  const cold = sorted.filter((e) => ageDays(lastActivity(e), o.now) > o.activeDays);

  const columns: Column[] = [
    { label: "repo" },
    { label: "lang" },
    { label: "age", align: "right" },
    { label: "8 weeks" },
    { label: "commits", align: "right" },
    { label: "iss", align: "right" },
    { label: "state" },
    { label: "note", flex: true },
  ];

  const sections: Section[] = [
    { columns, rows: (o.showAll ? sorted : warm).map((e) => triageRow(e, o)) },
  ];

  if (!o.showAll && cold.length) {
    sections.push({
      title: `cold (${cold.length})`,
      note: `untouched ${o.activeDays}d+ · --all to show`,
      rows: [{ cells: [c(cold.map((e) => e.name).join("  "), "dim")] }],
    });
  }

  return { title: "SHELF", meta: o.meta, warning: o.warning, sections };
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
      return { title, note, rows: [{ cells: [c("✓ nothing", "good")] }] };
    }
    return {
      title: `${title} (${rows.length})`,
      note,
      columns: [{ label: "repo" }, { label: "detail", flex: true }],
      rows: rows.map((f) => ({
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

export function showView(
  e: Entry,
  commits: CommitLine[],
  o: { login: string; now: number; meta: string; commitError?: string },
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
    fact("8 weeks", `${sparkline(gh.weeks)}  ${gh.commits8w} commits`, "accent");
    if (gh.ci) fact("CI", gh.ci, gh.ci === "SUCCESS" ? "good" : gh.ci === "FAILURE" ? "bad" : "warn");
    fact("url", ghUrl(gh.name, o.login), "plain", ghUrl(gh.name, o.login));
    if (gh.homepage) fact("homepage", gh.homepage, "plain", gh.homepage);
  }

  if (e.local) {
    const l = e.local;
    if (!gh) {
      fact("8 weeks", `${sparkline(l.weeks)}  ${l.commits8w} commits (local log)`, "accent");
    }
    fact("local", l.path, "good");
    fact("branch", `${l.branch ?? "(detached)"}${l.upstream ? ` → ${l.upstream}` : " (no upstream)"}`);
    fact("worktree", localNote(l), l.dirty || l.ahead ? "warn" : "good");
  } else if (gh) {
    fact("local", "not cloned", "dim");
  }

  sections.push({
    title: `${e.name}${gh?.description ? " — " + gh.description : ""}`,
    columns: [{ label: "" }, { label: "", flex: true }],
    rows: facts,
  });

  if (o.commitError) {
    sections.push({ title: "recent", rows: [{ cells: [c(o.commitError, "warn")] }] });
  } else if (commits.length) {
    sections.push({
      title: "recent",
      columns: [{ label: "when", align: "right" }, { label: "commit", flex: true }],
      rows: commits.map((k) => ({
        cells: [c(relTime(Date.parse(k.date), o.now), "dim"), c(k.message)],
      })),
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
    columns: [{ label: "repo" }, { label: "what it is", flex: true }, { label: "updated", align: "right" }],
    rows: repos
      .sort((a, b) => Date.parse(b.pushedAt) - Date.parse(a.pushedAt))
      .map((r) => ({
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
