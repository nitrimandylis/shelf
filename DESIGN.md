# Design

The visual system for shelf's HTML views. The terminal renderer shares the data
model but has its own constraints; this document is about the browser.

## The scene

Nick opens this at his desk, at night, on a large display, beside a terminal he
is already working in. He is not reading — he is scanning forty-six rows for the
two or three that need him. The page is open for thirty seconds at a time,
several times a day.

The page looks like what the tool is: a terminal program. Not as costume — it
renders the same data as the CLI, on the same character grid, in the same
monospace. Dark is the real design; a light variant exists for daylight.

## Register and the monospace rule

Register is **product**: design serves the task.

Nick's standing `monospace-minimal` rule (mono is for data, never labels or
nav) was written for **brand surfaces** after mono crept into an AMTF footer and
year switcher. It does not bind here, and that scoping is deliberate: on a CLI's
own surface the monospace grid *is* the identity, and splitting chrome into a
sans face would make the page look like a web app that reports on a terminal
rather than a continuation of one.

Everything on this page is monospace. That is the exception, not a new default.

## Color

**Monochrome structure, ANSI accents.** Deep black ground, dark grey frames and
rules, white data. Colour appears only where it carries meaning — state, and the
one interaction accent. Nothing decorative is ever coloured, which is what makes
the eight coloured cells on a forty-six row page findable.

| Role | Dark | Light | Carries |
|---|---|---|---|
| `--bg` | `#0a0a0b` | `#fbfbfa` | ground |
| `--surface` | `#131316` | `#f2f2ef` | hovered rows |
| `--line` | `#2c2c31` | `#d3d3ce` | frames, rules |
| `--line-bright` | `#3d3d44` | `#b4b4ae` | empty-week baseline |
| `--ink` | `#e9e9ec` | `#16161a` | data |
| `--dim` | `#9a9aa2` | `#5c5c64` | labels, quiet state |
| `--green` | `#7ec96b` | `#2f7d24` | synced, clean, passing |
| `--yellow` | `#e0b252` | `#8a5c00` | unpublished, dirty, stale |
| `--red` | `#ec6a6a` | `#bc2f2e` | failing CI, dead link |
| `--cyan` | `#5cc2d6` | `#0f6c80` | **interaction only** |

Tuned ANSI, not raw primaries: `#00ff00` on black vibrates and reads as a toy.

**Cyan means interaction and nothing else** — links on hover, focus rings, the
active `[x]`, the sort indicator, a hovered chart bar. This is why the activity
bars are `--ink` and not cyan: bar *height* already carries the data, so
colouring them would spend the accent on decoration.

`remote` is the majority state (34 of 46) and gets `--dim`, the quietest
treatment on the page. The rare states are the loud ones. That inversion is the
whole point of the view.

**Measured, not asserted.** All text clears WCAG AA in both schemes; lowest is
4.59:1. Verified by painting each value to a canvas and reading back sRGB, with
a white-on-black sanity check that must return exactly 21 — an earlier pass
parsed `oklch()` components as RGB and produced confident nonsense. Frame
borders sit at ~1.4:1 by intent: they are structure, not a state indicator, and
a TUI border is meant to be quiet.

## Typography

One family: `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas`.
Installed locally, referenced by name, never fetched — the page makes no network
requests.

**15px on a 24px line, and those two variables are the whole scale.** Every
horizontal measure is in `ch` and every vertical one in `--lh`, so changing
`--fs`/`--lh` resizes frames, padding, column widths and the activity chart
together — verified: at 13px the chart measured 62.4px and at 15px it measures
72px, both exactly eight rendered characters.

Fixed, not fluid: product UI is viewed at consistent DPI. The one exception is
below 600px, where `--fs` steps back to 13px — shrinking the derived grid is
cheaper than dropping another column, and the four that remain (repo, age,
state, note) all earn their place.

Ligatures off (`font-variant-ligatures: none`) because `!=` and `=>` in commit
messages should read as the characters they are. Tabular numerals throughout.

Hierarchy comes from weight, brightness and letter-spacing, never from a second
face: 700 with `0.06em` tracking for section legends, 400 for data, `--dim` for
labels.

## Layout

**The character grid is real, not a metaphor.** Every horizontal measure is in
`ch`: page width `132ch`, gutters `2ch`, column padding `2ch`, and the activity
chart is exactly `8ch` — verified at 72px against eight rendered characters.
Rows are exactly one `--lh`.

- Frames are **CSS borders, square corners** — not literal `┌─┐` characters.
  Identical look, but they survive reflow and stay out of copy-paste and screen
  readers.
- Section titles sit in the frame as a legend notch, absolutely positioned with
  a background matching the ground.
- Sticky header; column headers stick beneath it at a `--head-h` measured in JS
  by a **ResizeObserver on the header element**, not a window-resize listener.
  The header's height changes without the window resizing — a warning appears,
  or the drawer opens and re-wraps its controls (57px → 85px). Observe the
  element, don't guess at the events that might have changed it.
- **The table sizes to its content (`width: auto`), never `100%`.** With `100%`
  the last column absorbed every spare pixel: on a wide screen the mostly-empty
  note column ran to 543px while the data crammed into the left half. A terminal
  table is as wide as its widest row and no wider.
- Responsive is structural: columns drop by container width (`lang`/`iss` at
  880px, `commits` at 740, the chart at 560). **`note` never drops** — it
  carries UNPUBLISHED, dirty and failing CI, the reason to open the page at all,
  and it is the only column allowed to wrap.
  **These thresholds are measured, not guessed**: content-sized, the full
  eight-column table is 810px, so it needs ~870px of container once wrap and
  frame padding are counted. Changing `--fs` or the column set means
  re-measuring them.

## Components

Every interactive element has default, hover, focus-visible, active, disabled.
Focus is a 1px cyan outline, never removed.

- **Facet chips** are `[ ]` / `[x]` toggles — the terminal's checkbox. The
  bracket carries state, the count stays in `--ink`.
- **Buttons** are `[ refresh ]`, bracketed rather than boxed.
- **Activity chart** is inline SVG on a `viewBox` of character cells, so it
  scales with the font instead of fighting it. Self-scaled per repo; **any
  non-zero week is at least 14% height** so "quiet" and "nothing" stay
  distinguishable, mirroring the terminal's `▂` floor. Bars name their week and
  count on hover.
- **State** is a glyph plus a word (`● synced`), identical in both renderers.
  On a character grid the glyph is the marker; there is no CSS dot.
- **Selection is state, not a side effect of `j`/`k`.** Clicking a row selects
  it, and the selection is restored by repo name after any re-render, because
  filtering, sorting and refresh rebuild every row. It used to reset to -1 on
  every render, which made `o` silently do nothing on a fresh page.
- **A key that cannot act says so.** `o` on an unpublished repo, or with nothing
  selected, flashes a line in the warning slot for 2.6s. Silence is
  indistinguishable from a broken keybind — which is exactly how it was
  reported.
- **Empty state** appears only on a filter miss. An audit where every check came
  back clean also renders zero rows, and telling the user to clear a filter they
  never set would be nonsense.

## Motion

100–250ms, `ease-out`. State only: hover, focus, the refresh progress bar, and
the card drawer. No page-load choreography — the page loads into a task.

**The drawer is a grid column, not an overlay.** Opening a card animates
`grid-template-columns` from `1fr 0` to `1fr var(--drawer-w)` (`min(150ch, 54vw)`) over 280ms on
`cubic-bezier(0.32, 0.72, 0, 1)`, the iOS drawer curve — the built-in easings
are too weak to read as deliberate. The panel rides that with a short
`translateX` and an opacity fade so it slides in rather than being unveiled.

Two rules this had to respect:

- **`j`/`k` must not re-animate.** Walking the list with the card open is a
  keyboard action repeated constantly, and animation on a repeated keyboard
  action makes an interface feel slow. Only open and close transition; the
  content swap is instant. Verified: the drawer stays at exactly one width
  through a `j` press.
- **This is a layout animation, which the usual rule forbids.** Transform and
  opacity alone cannot make the table genuinely narrower, and side-by-side
  requires it. So it was measured rather than assumed: median 6.1ms, worst
  6.7ms, zero frames over 16.7ms across the transition with 46 rows. If that
  ever regresses, FLIP is the fallback.

Consequences worth keeping:

- **Column drops are `@container`, not `@media`.** The drawer narrows the table
  without changing the viewport, so viewport queries would never fire and the
  columns would squeeze instead of dropping. `.main` is the container.
- **`.page` uses `overflow-x: clip`, never `hidden`** — `clip` does not create a
  scroll container, so the sticky header inside keeps working.
- **`.drawer > .frame`, never `.drawer .frame`.** Each section inside the drawer
  has its own `.frame`, so the unscoped selector gave every one of them the
  outer panel's `min-height: calc(100vh - 4ch)` and buried the README a full
  viewport below the fold. It went unnoticed while the value was `100%`, which
  resolved to auto and did nothing.
- **The closed drawer is `justify-self: start`** so a collapsed 0px column parks
  it off-screen right instead of overflowing leftward across the table, and it
  is `pointer-events: none` while closed or an invisible panel would swallow
  clicks.
- Below 900px there is no room to split: the drawer takes the full width and the
  table column collapses to zero.

`prefers-reduced-motion: reduce` keeps the opacity fade (it aids comprehension)
and drops every movement, per the accessibility rule. Content is never gated
behind a transition.

**A transition will lie to you when measuring.** Reading `getComputedStyle`
immediately after setting a class returns the *interpolated* value at t=0, which
made row selection look broken when it was not. Wait out the duration before
trusting a computed colour.

## Architecture

The server renders the shell and embeds the `View` model as JSON in a
`<script type="application/json">`. The client renders rows from that model, so
filtering, grouping, sorting and refresh all operate on data rather than DOM
text. Refresh fetches a new model and re-renders in place; it never reloads.

That keeps "one data model, two renderers" intact — the terminal consumes the
`View` in TypeScript, the browser consumes the same `View` as JSON.

Stated cost: the page requires JavaScript, and scraping its markup yields
nothing. `--json` is the machine path.

Entirely self-contained: inline CSS, inline JS, no external requests, so the
static `-o` export works from `file://`.
