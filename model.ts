// Types and the pure logic that turns raw GitHub + git output into rows.
// Everything here is side-effect free so shelf.test.ts can exercise it directly.

export type Tone = "plain" | "dim" | "good" | "warn" | "bad" | "accent";

export type Repo = {
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
  defaultBranch: string | null;
  lastCommit: { date: string; message: string } | null;
  weeks: number[]; // 8 buckets, oldest -> newest
  commits8w: number;
  ci: string | null;
};

export type LocalRepo = {
  name: string; // directory basename
  path: string;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  dirty: number;
  remoteOwner: string | null;
  remoteName: string | null;
  lastCommitAt: string | null;
  weeks: number[]; // 8 buckets from the local log, oldest -> newest
  commits8w: number;
};

// state is the whole point of the tool: where does this repo actually exist.
//   synced  - on GitHub and cloned here
//   remote  - on GitHub, not on this machine
//   local   - on this machine only (no origin, or origin owned by someone else)
export type Entry = {
  name: string;
  state: "synced" | "local" | "remote";
  external: boolean; // local clone of someone else's repo
  gh: Repo | null;
  local: LocalRepo | null;
};

const DAY = 86_400_000;

// ---------------------------------------------------------------- merge

function remoteKey(l: LocalRepo): string | null {
  if (!l.remoteOwner || !l.remoteName) return null;
  return `${l.remoteOwner.toLowerCase()}/${l.remoteName.toLowerCase()}`;
}

/**
 * Match strictly on the origin remote, never on directory name. A local repo
 * with no origin is unpublished by definition even when a same-named repo
 * exists on GitHub, and calling those "synced" would be a lie.
 */
export function mergeEntries(repos: Repo[], locals: LocalRepo[], login: string): Entry[] {
  const byKey = new Map<string, LocalRepo>();
  for (const l of locals) {
    const k = remoteKey(l);
    if (k) byKey.set(k, l);
  }

  const entries: Entry[] = [];
  const claimed = new Set<LocalRepo>();

  for (const r of repos) {
    const l = byKey.get(`${login.toLowerCase()}/${r.name.toLowerCase()}`) ?? null;
    if (l) claimed.add(l);
    entries.push({
      name: r.name,
      state: l ? "synced" : "remote",
      external: false,
      gh: r,
      local: l,
    });
  }

  for (const l of locals) {
    if (claimed.has(l)) continue;
    const owner = l.remoteOwner?.toLowerCase();
    entries.push({
      name: l.name,
      state: "local",
      external: !!owner && owner !== login.toLowerCase(),
      gh: null,
      local: l,
    });
  }

  return entries;
}

// ---------------------------------------------------------------- time

/** Most recent activity we know about, from either side. */
export function lastActivity(e: Entry): number {
  const a = e.gh ? Date.parse(e.gh.pushedAt) : NaN;
  const b = e.local?.lastCommitAt ? Date.parse(e.local.lastCommitAt) : NaN;
  const vals = [a, b].filter((n) => Number.isFinite(n));
  return vals.length ? Math.max(...vals) : 0;
}

export function ageDays(ms: number, now: number): number {
  if (!ms) return Infinity;
  return (now - ms) / DAY;
}

/** Compact age: 4h, 3d, 5w, 7mo, 2y. Empty string for unknown. */
export function relTime(ms: number, now: number): string {
  if (!ms || !Number.isFinite(ms)) return "-";
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "now";
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h`;
  const d = h / 24;
  if (d < 14) return `${Math.floor(d)}d`;
  const w = d / 7;
  if (w < 9) return `${Math.floor(w)}w`;
  const mo = d / 30.44;
  if (mo < 18) return `${Math.floor(mo)}mo`;
  return `${Math.floor(d / 365.25)}y`;
}

// ---------------------------------------------------------------- sparkline

export const WEEKS = 8;

/**
 * Bucket commit timestamps into trailing weeks, oldest first. Used for the
 * local log; GitHub returns its own counts already bucketed the same way.
 */
export function weekBuckets(isoDates: string[], now: number, weeks = WEEKS): number[] {
  const out = new Array(weeks).fill(0) as number[];
  for (const d of isoDates) {
    const t = Date.parse(d);
    if (!Number.isFinite(t)) continue;
    const daysAgo = (now - t) / DAY;
    if (daysAgo < 0 || daysAgo >= weeks * 7) continue;
    const idx = weeks - 1 - Math.floor(daysAgo / 7);
    if (idx >= 0 && idx < weeks) out[idx]!++;
  }
  return out;
}

const LEVELS = "▁▂▃▄▅▆▇█";

/**
 * Self-scaled: the bar shows the SHAPE of the last 8 weeks, the commit count
 * column carries the magnitude. A week with zero commits is the flat baseline
 * (▁); any week with commits is at least ▂, so "quiet" and "nothing" differ.
 */
export function sparkline(weeks: number[]): string {
  if (!weeks.length) return "        ";
  const max = Math.max(...weeks);
  if (max === 0) return LEVELS[0]!.repeat(weeks.length);
  return weeks
    .map((n) => {
      if (n === 0) return LEVELS[0];
      const idx = 1 + Math.round((n / max) * 6);
      return LEVELS[Math.min(7, Math.max(1, idx))];
    })
    .join("");
}

// ---------------------------------------------------------------- width

/**
 * Display width in terminal cells. Handles the two cases that actually appear
 * in this data: ANSI escapes (zero width) and wide CJK/emoji (two cells).
 */
export function displayWidth(s: string): number {
  const plain = s.replace(/\x1b\[[0-9;]*m/g, "");
  let w = 0;
  for (const ch of plain) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x200d || (cp >= 0x0300 && cp <= 0x036f) || cp === 0xfe0f) continue;
    if (
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1f64f) ||
      (cp >= 0x1f900 && cp <= 0x1f9ff)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/** Truncate to n display cells, with an ellipsis when it had to cut. */
export function truncate(s: string, n: number): string {
  if (n <= 0) return "";
  if (displayWidth(s) <= n) return s;
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (w + cw > n - 1) break;
    out += ch;
    w += cw;
  }
  return out + "…";
}

export function padTo(s: string, n: number, align: "left" | "right" = "left"): string {
  const gap = Math.max(0, n - displayWidth(s));
  return align === "right" ? " ".repeat(gap) + s : s + " ".repeat(gap);
}

// ---------------------------------------------------------------- formatting

export function humanSize(kb: number): string {
  if (kb < 1024) return `${kb}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}MB`;
  return `${(mb / 1024).toFixed(1)}GB`;
}

export const STATE_MARK: Record<Entry["state"], string> = {
  synced: "●",
  local: "○",
  remote: "▲",
};

/** The short local-state note: "clean", "2 dirty", "3 ahead", or "". */
export function localNote(l: LocalRepo | null): string {
  if (!l) return "";
  const bits: string[] = [];
  if (l.dirty > 0) bits.push(`${l.dirty} dirty`);
  if (l.ahead > 0) bits.push(`${l.ahead} ahead`);
  if (l.behind > 0) bits.push(`${l.behind} behind`);
  if (!bits.length) return "clean";
  return bits.join(" ");
}

// ---------------------------------------------------------------- audit

export type Finding = {
  repo: string;
  detail: string;
  url?: string;
};

export type AuditReport = {
  hygiene: Finding[];
  stale: Finding[];
  heavy: Finding[];
  unpublished: Finding[];
  deadLinks: Finding[];
  skippedPrivate: number;
};

/**
 * The checks that do not need the network. Hygiene is public-only on purpose:
 * a private repo with no topics is not a defect, and reporting it as one
 * makes the whole section noise.
 */
export function auditOffline(
  entries: Entry[],
  now: number,
  opts: { activeDays: number; heavyMb: number },
): Omit<AuditReport, "deadLinks"> {
  const hygiene: Finding[] = [];
  const stale: Finding[] = [];
  const heavy: Finding[] = [];
  const unpublished: Finding[] = [];
  let skippedPrivate = 0;

  for (const e of entries) {
    const r = e.gh;
    if (r) {
      if (r.visibility === "public") {
        const missing: string[] = [];
        if (!r.description) missing.push("description");
        if (!r.hasReadme) missing.push("README");
        if (!r.license) missing.push("license");
        if (!r.topics.length) missing.push("topics");
        if (missing.length) hygiene.push({ repo: r.name, detail: `no ${missing.join(", no ")}` });
      } else {
        skippedPrivate++;
      }

      const days = ageDays(Date.parse(r.pushedAt), now);
      if (!r.archived && !r.fork && days > opts.activeDays) {
        stale.push({ repo: r.name, detail: `${Math.floor(days)}d since push, not archived` });
      }

      const mb = r.diskUsageKb / 1024;
      if (mb > opts.heavyMb) {
        heavy.push({ repo: r.name, detail: humanSize(r.diskUsageKb) });
      }
    }

    if (e.state === "local" && !e.external) {
      unpublished.push({ repo: e.name, detail: e.local?.path ?? "" });
    }
  }

  const bySize = (a: Finding, b: Finding) => a.repo.localeCompare(b.repo);
  hygiene.sort(bySize);
  stale.sort(bySize);
  heavy.sort(bySize);
  unpublished.sort(bySize);

  return { hygiene, stale, heavy, unpublished, skippedPrivate };
}
