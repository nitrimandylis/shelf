# Design

The visual system for shelf's HTML views. The terminal renderer is governed by
the same data model but has its own constraints; this document is about the
browser.

## The scene

Nick opens this at his desk, at night, on a large display, next to a terminal
he is already working in. He is not reading — he is scanning forty-six rows for
the two or three that need him. The page is open for thirty seconds at a time,
several times a day. It sits beside a themed dark terminal, so it must not glare;
it is also opened in daylight, so it must not assume dark.

That forces the answer: **both schemes, neither as default.** The page follows
`prefers-color-scheme` and commits to neither.

## Color

**Strategy: restrained.** Tinted neutrals plus one accent, with a semantic state
vocabulary on top. Colour here is data, never decoration — every saturated pixel
on the page means something specific.

Neutrals carry a slight cool tint toward the accent's own hue, not toward
warmth-by-default. All values are OKLCH.

| Role | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `oklch(99% 0.002 250)` | `oklch(16% 0.008 250)` | page |
| `--surface` | `oklch(97% 0.004 250)` | `oklch(20% 0.010 250)` | header, panels, hovered rows |
| `--ink` | `oklch(23% 0.012 250)` | `oklch(93% 0.006 250)` | primary text and data |
| `--muted` | `oklch(50% 0.015 250)` | `oklch(66% 0.014 250)` | labels, secondary data |
| `--line` | `oklch(91% 0.005 250)` | `oklch(28% 0.010 250)` | rules, borders |
| `--accent` | `oklch(52% 0.17 255)` | `oklch(74% 0.14 255)` | links, selection, activity bars |

State roles, and the only things allowed to use them:

| Role | Meaning in shelf | Never used for |
|---|---|---|
| `--good` | synced, clean worktree, passing CI, a check that found nothing | decoration, success banners |
| `--warn` | unpublished, dirty, stale, oversized, missing metadata | anything merely unusual |
| `--bad` | failing CI, a dead link | anything recoverable |
| `--muted` | remote (on GitHub, not here) — the normal case, deliberately quiet | primary data |

`remote` is the majority state and gets the quietest treatment on the page. The
rare states are the loud ones. That inversion is the whole point of the view.

**Contrast floor: 4.5:1 for all text**, including muted labels and the filter
placeholder. Verified on the rendered page in both schemes, not read off the
CSS.

## Typography

One family for the chrome, one for the data. That is a contrast axis (humanist
sans against a monospace), not two similar sans-serifs.

- **Chrome** — `ui-sans-serif, -apple-system, system-ui`. Headings, labels,
  column headers, buttons, section titles.
- **Data** — `ui-monospace, SFMono-Regular, Menlo`. Repo names, counts, ages,
  paths, commit messages, anything in a table cell.

This split is a standing rule in Nick's system: monospace is for data, never for
labels or navigation. A mono column header is a bug.

Fixed rem scale, no clamp. Product UI is viewed at consistent DPI and fluid
headings shrink where they should not. Ratio ~1.15 between steps.

| Step | Size | Use |
|---|---|---|
| `--t-xs` | 0.6875rem | column headers, chips, meta |
| `--t-sm` | 0.8125rem | table data, the default |
| `--t-md` | 0.9375rem | section titles |
| `--t-lg` | 1.125rem | page title, repo name in `show` |

## Layout

- **Full width, capped at 1400px.** This is a table; horizontal room is the
  affordance. Not a 720px reading column.
- **Sticky header** carrying title, freshness, filter, grouping and refresh. It
  survives scrolling because the filter is the primary control.
- **Facet strip** under the header: counts that are also filters. Compact inline
  chips, never a row of big-number stat cards (that template is banned, and it
  would push the actual data below the fold).
- Vertical rhythm on a 4px base. Table rows are 28px, dense on purpose.
- Wide content scrolls inside its own container; the page body never scrolls
  horizontally.
- Responsive behaviour is structural: below 900px the lower-value columns drop
  in priority order (note, then language, then issues), the table never squeezes.

## Components

Every interactive element ships default, hover, focus-visible, active and
disabled. Focus rings are a 2px accent outline with a 2px offset, never removed.

- **Row** — the primary object. Hover raises it to `--surface`. Selection (via
  keyboard) gets an accent left marker drawn as a `::before` block, not a
  `border-left` stripe.
- **State pill** — a dot plus a word, coloured by state role. The dot carries
  the colour, the word carries the meaning; neither alone.
- **Activity bars** — inline SVG, eight bars, oldest to newest, self-scaled per
  repo. Zero-weeks render as a 1px baseline tick so "quiet" and "nothing" stay
  distinguishable, matching the terminal's rule. Hovering a bar names the week
  and its commit count.
- **Facet chip** — toggles a filter, shows a count, has a pressed state.
- **Empty state** — teaches what the view would show, never bare "no results".
- **Refresh** — has an explicit in-flight state. A refresh takes 9-11 seconds
  and must never look like a frozen page.

## Motion

150-250ms, `ease-out-quart`. Motion conveys state only: hover, focus, the
refresh in-flight pulse, rows entering after a regroup. No page-load
choreography — the page loads into a task.

Every animation has a `prefers-reduced-motion: reduce` alternative that
crossfades or resolves instantly. Content is never gated behind a transition:
rows are visible by default and animation enhances an already-rendered table.

## Architecture

The server renders the shell and embeds the `View` model as JSON in a
`<script type="application/json">`. The client renders rows from that model, so
grouping, sorting, filtering and refresh all operate on data rather than on DOM
text. Refresh fetches a new model and re-renders in place; it never reloads the
page.

That keeps the "one data model, two renderers" property intact — the terminal
renderer consumes the `View` in TypeScript, the browser renderer consumes the
same `View` as JSON.

The page is entirely self-contained: inline CSS, inline JS, no external
requests. It has to work as a `file://` static export with no server behind it.
