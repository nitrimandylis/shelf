# shelf

A CLI that shows every repo you have — the ones on GitHub, the ones on this
machine, and the difference between the two.

## Register

product

The surface is a tool. Design serves the task of deciding what to work on next;
it is never the product itself. Density is a feature, familiarity is a feature,
and the interface should disappear into the scan.

## Why it exists

`gh repo list` shows names with no activity, no local state and no issues.
github.com shows one repo at a time and stops scaling somewhere around thirty.
Neither can see this machine, so neither can report a dirty worktree, an
unpushed commit, or a repo that was never published at all.

shelf's lane is that union. It is not a dashboard and not a replacement for
either tool.

## Where it sits

glance already reads GitHub, but only as a contributions heatmap and a Notion
coding-task list; it never enumerates repos. deck was shelved for duplicating
glance. shelf overlaps neither: it is a terminal command you run on purpose,
answering a question that needs both halves of the picture at once.

## Four jobs

1. **Triage** (`shelf`) — what is warm, what is cold, what is unpushed.
2. **Audit** (`shelf audit`) — hygiene plus the checks that actually fire.
3. **Inspect** (`shelf show <repo>`) — one repo on one screen.
4. **Index** (`shelf index`) — the uncurated public list of everything built.

Each has both a terminal and an HTML rendering, kept cheap by one data model
feeding two renderers rather than four bespoke pages.

## Decisions

- **Cache GitHub, run local live.** A cold GitHub pull measures 9-11s, so it is
  cached at `~/.cache/shelf/repos.json` with a 60-minute TTL; warm runs are
  0.1s. The local scan is 0.18s for a dozen repos, so it never gets cached and
  never goes stale.
- **The sparkline is what makes the query slow, and it stays.** Measured by
  field group: metadata alone 4.2s, adding the eight weekly commit counts 8.3s,
  adding README/issue/PR lookups on top costs nothing measurable. Trimming
  anything other than the weekly buckets buys no time, and trimming those
  removes the point of the view.
- **A stale cache is served, not an error.** If a refresh fails while a cache
  exists, shelf warns, shows the old data and exits 0. Losing the network
  should not make a read impossible.
- **Match on origin URL, never on directory name.** A local folder with no
  remote is unpublished even when a same-named GitHub repo exists, because it
  is genuinely not pushed there. The alternative silently claims work is safe
  when it is not.
- **Two raw signals, no composite score.** Push age and an eight-week commit
  sparkline sit side by side and the reader decides. A single warmth number
  means tuning weights forever and never being able to explain a ranking.
- **The sparkline shows shape, the count shows magnitude.** Self-scaled per
  repo, oldest week on the left. Zero weeks are the flat baseline so "quiet"
  and "nothing" are never the same glyph.
- **Empty audit sections print a tick.** Hiding them would make a clean run
  look like a run that did not happen.
- **Hygiene skips private repos.** A private repo with no topics is not a
  defect, and reporting it as one turns the section into noise.
- **Read-only against GitHub, always.** No archiving, no topic editing, no
  cloning. The tool reports; the user acts.
- **HTML is an ephemeral server, not a daemon.** Random port on loopback, dies
  with Ctrl-C. `-o FILE` is the static path for anything worth keeping.
- **The browser view earns being a browser view.** Real SVG activity charts,
  state as colour and position rather than a word to read, facet chips that are
  also the counts, grouping, column sort and keyboard navigation. If it were
  only the terminal table with nicer fonts it should not exist.
- **The page renders from the embedded model, not from server-rendered rows.**
  The server ships the `View` as JSON in the document and the client draws from
  it, so filter, group, sort and refresh all operate on data. That keeps one
  data model feeding both renderers instead of two divergent templates. The
  cost, stated plainly: the page needs JavaScript, and scraping its markup
  yields nothing — `--json` is the machine path.
- **Refresh never blocks the page.** A cold pull is 9-11 seconds, so refresh
  fetches `/api/data`, shows a progress indicator and swaps in place. A page
  that freezes for ten seconds reads as broken, and reloading would do exactly
  that.
- **A refresh that silently fell back to cache still says so.** The payload
  carries the warning and the client re-renders it, or stale data would look
  current.

## The finding that shaped the audit

Measured across all 40 repos on 2026-08-06: every public repo already had a
description and a README, and the only missing license was the profile repo.
A README/LICENSE/topics checklist fires almost never.

So audit keeps hygiene as one section and adds four checks that do fire:
stale-but-not-archived, dead homepage links, repos over 20MB (usually
committed binaries), and local-only work. Empty sections still print, so the
report never overstates what it looked at.

## Not doing

- **Writing to GitHub.** Fixing an audit finding is `gh` or `git`, not shelf.
- **Starred repos, orgs, forks.** Scope is repos the user owns plus local
  clones. Starred repos are a bookmark manager, a different product.
- **A persistent dashboard.** That is glance, and it already runs.
- **Curated presentation.** breakOS is the designed portfolio; `index` is the
  auto-generated long tail that links out to it.
- **History beyond eight weeks.** The window is fixed on purpose.

## Status

Built 2026-08-06. Not published. 79 tests, typecheck clean, man page linted,
verified against live data and in a real browser in both colour schemes.
