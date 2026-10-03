---
name: shelf-cli
description: Drive the shelf CLI — one list of every GitHub repo plus every git repo on this machine, with warm/cold triage, a hygiene and staleness audit, per-repo detail, and an uncurated public index. Use whenever the user asks what repos they have, which projects are active, stale or abandoned, what is unpushed or uncommitted, which repos exist only locally, whether a repo is missing a README or license, how big a repo is, or wants an overview or list of their GitHub projects.
---

# shelf

Merges the user's GitHub repositories with the git repositories on their disk
and reports them as one list. Every repo carries a **state**:

- `synced` — on GitHub and cloned here
- `remote` — on GitHub, not cloned here
- `local` — on this machine only (no origin, or an origin someone else owns)

That union is the whole point. `gh repo list` cannot see unpushed commits,
dirty worktrees, or a repo that exists nowhere but this machine.

## Setup

Run `shelf`. If the binary is not on PATH, run `bun run shelf.ts` from the repo
instead; every command and flag below is identical.

Auth is `GITHUB_TOKEN` (or `GH_TOKEN`), falling back to the token from
`gh auth token`. If neither works the tool names both and exits 1. Never read
or echo the token.

First run writes `~/.config/shelf/config.json` with defaults and prints the
path. Keys worth knowing: `scanPaths` (where to look for local repos — defaults
to common roots like `~/code`, `~/src`, `~/projects`, `~/Developer`, skipping
any that do not exist; **if the user sees no local repos, this is almost always
why**), `activeDays` (the
warm/cold threshold, default 90), `cacheTtlMinutes` (default 60), `heavyMb`
(default 20), `exclude`, `scanDepth` (how deep under each scanPath, default 2).

## Commands

Every command below is safe to run unattended: they all read, none write
anything except the cache, the config on first run, and `-o FILE`. There is no
TUI, no picker and no prompt anywhere in this tool.

| Command | What you get |
|---|---|
| `shelf` | Triage. Every repo by most recent activity, cold ones collapsed. |
| `shelf --all` | Same, cold repos expanded. |
| `shelf audit` | Five checks: hygiene, stale, dead links, heavy, unpublished. |
| `shelf show <repo>` | One repo in full, plus recent commits and CI. |
| `shelf index` | Every public non-fork repo, grouped by language. |
| `shelf scan` | Which roots are searched for local repos, and what each holds. |
| `shelf scan --add PATH` | Add a scan root. `--remove PATH` drops one. |

`shelf scan --add` / `--remove` are the only commands that write anything
outside the cache, and they only touch `scanPaths` in the config. They are safe
to run unattended, but **do not add roots speculatively** — ask the user where
their code lives rather than guessing.

**Always add `--json`** when you are consuming the output rather than showing
it to the user. Human output is aligned and coloured and is not a parsing
target.

The one command that blocks: **`--html` starts a server and never returns** (`shelf scan --html` and `shelf scan -o` are rejected with exit 1)
(it runs until Ctrl-C). Never invoke it from a tool call — you will hang until
timeout. If the user wants the browser view, hand them the command to type.
`-o FILE` is the non-blocking alternative: it writes the same page to a file
and exits. `--no-open` suppresses the automatic browser launch.

Cards (the per-repo side panel with the README) exist only in the served page,
because they are fetched from `/api/repo?name=<repo>`. A written `-o` file has
no server, so its rows open GitHub instead. To get the same data headlessly use
`shelf show <repo> --json`.

**Never scrape the HTML.** The page renders client-side from a JSON model
embedded in a `<script type="application/json">`, so the markup contains no
rows and a text extractor gets nothing. Use `--json`, which is the same data
without the parsing.

## JSON shapes

`shelf --json` → `{fetchedAt, cacheAgeMinutes, login, warning, scanPaths, repos: [...]}`

`warning` is null when nothing is wrong. Check it before telling the user they
have no local repos — it distinguishes a misconfigured `scanPaths` from a
genuinely empty result.

Each repo is flat. The key rule: **`null` means the field does not apply, not
that it could not be read.** Every GitHub-side key (`visibility`, `language`,
`commits8w`, `weeks`, `ci`, `openIssues`, ...) is `null` for a local-only repo,
and every local-side key (`path`, `branch`, `dirty`, `ahead`, `behind`) is
`null` for a repo that is not cloned. `dirty: 0` is a clean worktree;
`dirty: null` is no worktree at all. Do not conflate them.

`shelf audit --json` → `{hygiene, stale, deadLinks, heavy, unpublished,
privateSkipped, linksChecked}`. The five checks are always arrays, empty when
clean. Findings are `{repo, detail, url?}`.

`shelf show <repo> --json` → one repo object plus `recentCommits`, `languages`, `latestRelease` and `hasReadmeBody`.

`shelf index --json` → `{login, repos: [...]}`, public non-forks only.

`shelf scan --json` → `{configPath, scanDepth, roots: [...]}`.

Useful one-liners:

```bash
shelf --json | jq '.repos[] | select(.state == "local") | .name'   # unpublished
shelf --json | jq '.repos[] | select(.dirty > 0) | {name, dirty}'  # uncommitted work
shelf audit --json | jq '.unpublished'
```

## Things that will bite you

- **The first run of the day takes 9-11 seconds.** That is GitHub's latency for
  the single GraphQL query, not a hang. Afterwards it is ~0.1s from cache. Give
  it a timeout of at least 30s and never retry on slowness — a retry just pays
  the cost twice.
- **A stale cache is served rather than failing.** If the refresh fails but a
  cache exists, shelf prints a warning, shows the cached data and **exits 0**.
  Check `cacheAgeMinutes` in the JSON before telling the user something is
  current. `--refresh` forces a refetch.
- **`--json` is stripped from argv before dispatch**, so it works in any
  position, including `shelf show --json swatch`.
- **The sparkline is self-scaled per repo.** A full block in one row and a full
  block in another do not mean the same number of commits. Read magnitude from
  the commit count, never from the bar.
- **Hygiene deliberately skips private repos**, reporting only a count. A
  private repo with no topics is not a defect. Do not report `privateSkipped`
  as a problem.
- **`--no-links` makes audit work offline**, and sets `linksChecked: false`. An
  empty `deadLinks` with `linksChecked: false` means "not checked", not "all
  fine".
- **A dead-link finding is not always a dead site.** Each URL gets 10s and one
  retry, but a `kind: "no-answer"` finding still only means it did not respond
  twice — cold starts on free hosting do that. `kind: "http-error"` is the solid
  one: the server answered with a 4xx/5xx. Report the difference; do not tell
  the user a site is down on a `no-answer` alone.
- **Local matching is by origin URL only, never by directory name.** A local
  folder named `nous` with no remote stays `local` even when a GitHub repo
  called `nous` exists, because it is genuinely not pushed there.
- **"no local repos found" almost always means the scan roots are wrong**, not
  that the user has no clones. `shelf scan` shows where it looked;
  `shelf scan --add ~/their/dir` fixes it. Reach for that before concluding
  anything about their machine.
- **`state: "local"` with `external: true`** is a clone of someone else's repo.
  It is not unpublished work and the audit does not report it as such.
- **Repos are excluded via config, not a flag.** There is no `--exclude`.
- **`show --json` does not return the README body**, only `hasReadmeBody`. The
  rendered HTML is served to the card; if you need the text, read it from the
  repo or the GitHub API directly.
- **A card costs one live GitHub call** (~0.75s) for README, languages, release
  and commits. It is fetched when the card opens, never up front for 46 repos.

## What it cannot do

- **It never writes to GitHub.** No archiving, no topic editing, no repo
  creation, no pushing. It is read-only against the API. Do not offer to fix an
  audit finding with shelf; fix it with `gh` or `git`.
- **It does not clone anything.** A `remote` repo stays remote until the user
  clones it themselves.
- **No starred repos, no orgs, no forks-of-others.** Scope is repos the user
  owns, plus local clones.
- **No per-file or per-branch detail.** `show` gives the default branch's
  recent commits and nothing deeper.
- **No history beyond eight weeks.** The sparkline window is fixed.
