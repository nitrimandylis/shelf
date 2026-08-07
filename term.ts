import { displayWidth, padTo, truncate, type Tone } from "./model.ts";
import type { View, Section, Cell, Column } from "./views.ts";

const CODES: Record<Tone, string> = {
  plain: "",
  dim: "\x1b[90m",
  good: "\x1b[32m",
  warn: "\x1b[33m",
  bad: "\x1b[31m",
  accent: "\x1b[36m",
};
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

const GAP = 2;
const MIN_COL = 4;

export function colorEnabled(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return !!process.stdout.isTTY;
}

export function termWidth(): number {
  const w = process.stdout.columns;
  return w && w > 20 ? w : 100;
}

function paint(text: string, tone: Tone | undefined, on: boolean): string {
  if (!on || !tone || tone === "plain" || !text) return text;
  return CODES[tone] + text + RESET;
}

const totalWidth = (w: number[]) => w.reduce((a, b) => a + b, 0) + GAP * Math.max(0, w.length - 1);

function naturalWidths(columns: Column[], rows: { cells: Cell[] }[]): number[] {
  return columns.map((col, i) => {
    let w = displayWidth(col.label);
    for (const r of rows) w = Math.max(w, displayWidth(r.cells[i]?.text ?? ""));
    return w;
  });
}

/**
 * Fit a table to `max` cells. Flex columns give way first, then the widest
 * column, and only when everything is already at MIN_COL does a trailing
 * column get dropped. A line must never exceed the terminal width, so the
 * last resort is dropping columns rather than wrapping.
 */
export function fitTable(
  columns: Column[],
  rows: { cells: Cell[] }[],
  max: number,
): { keep: number[]; widths: number[] } {
  const natural = naturalWidths(columns, rows);
  let keep = columns.map((_, i) => i);

  for (;;) {
    const cols = keep.map((i) => columns[i]!);
    const widths = keep.map((i) => natural[i]!);

    let guard = 0;
    while (totalWidth(widths) > max && guard++ < 10_000) {
      let target = cols.findIndex((c, k) => c.flex && widths[k]! > MIN_COL);
      if (target === -1) {
        let best = -1;
        for (let k = 0; k < widths.length; k++) {
          if (widths[k]! > MIN_COL && (best === -1 || widths[k]! > widths[best]!)) best = k;
        }
        target = best;
      }
      if (target === -1) break; // every column is at the floor
      widths[target] = widths[target]! - 1;
    }

    if (totalWidth(widths) <= max || keep.length === 1) {
      // One column that still cannot fit gets hard-truncated instead.
      if (keep.length === 1 && widths[0]! > max) widths[0] = max;
      return { keep, widths };
    }
    keep = keep.slice(0, -1);
  }
}

function renderTable(section: Section, max: number, on: boolean): string[] {
  const columns = section.columns!;
  const { keep, widths } = fitTable(columns, section.rows, max);
  const lines: string[] = [];

  const hasHeader = keep.some((i) => columns[i]!.label !== "");
  if (hasHeader) {
    const head = keep
      .map((i, k) => padTo(truncate(columns[i]!.label, widths[k]!), widths[k]!, columns[i]!.align))
      .join(" ".repeat(GAP))
      .trimEnd();
    lines.push(paint(head, "dim", on));
  }

  for (const row of section.rows) {
    const cells = keep.map((i, k) => {
      const cell = row.cells[i] ?? { text: "" };
      const text = truncate(cell.text, widths[k]!);
      // Padding the last left-aligned column would bake trailing spaces INSIDE
      // the colour escape, where a trailing-whitespace trim can never see them.
      const last = k === keep.length - 1;
      const body = last && columns[i]!.align !== "right" ? text : padTo(text, widths[k]!, columns[i]!.align);
      return paint(body, cell.tone, on);
    });
    lines.push(cells.join(" ".repeat(GAP)).replace(/[ \t]+$/, ""));
  }
  return lines;
}

function renderLines(section: Section, max: number, on: boolean): string[] {
  const out: string[] = [];
  for (const row of section.rows) {
    const tone = row.cells[0]?.tone;
    const text = row.cells.map((c) => c.text).join(" ");
    let line = "";
    for (const word of text.split(" ")) {
      if (line && displayWidth(line + " " + word) > max) {
        out.push(paint(truncate(line, max), tone, on));
        line = word;
      } else {
        line = line ? line + " " + word : word;
      }
    }
    if (line) out.push(paint(truncate(line, max), tone, on));
  }
  return out;
}

export function renderView(view: View, opts: { width?: number; color?: boolean } = {}): string {
  const max = opts.width ?? termWidth();
  const on = opts.color ?? colorEnabled();
  const out: string[] = [];

  const title = truncate(view.title, max);
  const metaRoom = max - displayWidth(title) - 2;
  const meta = metaRoom > 4 ? truncate(view.meta, metaRoom) : "";
  out.push(`${on ? BOLD + title + RESET : title}${meta ? "  " + paint(meta, "dim", on) : ""}`);
  if (view.warning) out.push(paint(truncate(`! ${view.warning}`, max), "warn", on));
  out.push("");

  for (const section of view.sections) {
    if (section.title) {
      const t = truncate(section.title, max);
      out.push(on ? BOLD + t + RESET : t);
    }
    if (section.note) out.push(paint(truncate(section.note, max), "dim", on));

    if (section.kind === "markdown") {
      // The terminal cannot draw rendered HTML, and dumping the raw README
      // would bury the rest of the view. Say where it lives instead.
      const kb = Math.max(1, Math.round((section.html?.length ?? 0) / 1024));
      out.push(paint(`${kb}KB · read it with --html`, "dim", on));
    } else {
      out.push(...(section.columns ? renderTable(section, max, on) : renderLines(section, max, on)));
    }
    out.push("");
  }

  return out.join("\n").replace(/\n+$/, "\n");
}
