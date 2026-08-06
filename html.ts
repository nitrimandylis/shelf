import type { View, Section, Cell } from "./views.ts";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cellHtml(cell: Cell): string {
  const tone = cell.tone && cell.tone !== "plain" ? ` class="t-${cell.tone}"` : "";
  const inner = cell.href
    ? `<a href="${esc(cell.href)}" target="_blank" rel="noreferrer">${esc(cell.text)}</a>`
    : esc(cell.text);
  const sort = cell.sort !== undefined ? ` data-sort="${esc(String(cell.sort))}"` : "";
  return `<td${tone}${sort}>${inner}</td>`;
}

function sectionHtml(section: Section, idx: number): string {
  const head = section.title ? `<h2>${esc(section.title)}</h2>` : "";
  const note = section.note ? `<p class="note">${esc(section.note)}</p>` : "";

  if (!section.columns) {
    const lines = section.rows
      .map((r) => `<p class="line t-${r.cells[0]?.tone ?? "plain"}">${esc(r.cells.map((c) => c.text).join(" "))}</p>`)
      .join("");
    return `<section>${head}${note}${lines}</section>`;
  }

  const showHead = section.columns.some((c) => c.label !== "");
  const thead = showHead
    ? `<thead><tr>${section.columns
        .map((c, i) => `<th data-col="${i}" class="${c.align === "right" ? "right" : ""}">${esc(c.label)}</th>`)
        .join("")}</tr></thead>`
    : "";
  const tbody = `<tbody>${section.rows.map((r) => `<tr>${r.cells.map(cellHtml).join("")}</tr>`).join("")}</tbody>`;

  return `<section>${head}${note}<table id="t${idx}" class="${showHead ? "sortable" : "plain"}">${thead}${tbody}</table></section>`;
}

const CSS = `
:root {
  --bg: #ffffff; --fg: #16181d; --dim: #6b7280; --line: #e5e7eb;
  --accent: #1d4ed8; --good: #15803d; --warn: #b45309; --bad: #b91c1c;
  --panel: #f9fafb;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d0f13; --fg: #e6e8ec; --dim: #8b93a1; --line: #242832;
    --accent: #7aa2f7; --good: #7bc97b; --warn: #e0af68; --bad: #f7768e;
    --panel: #14171d;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2rem 1.5rem 4rem; background: var(--bg); color: var(--fg);
  font: 15px/1.5 ui-sans-serif, -apple-system, system-ui, sans-serif;
}
.wrap { max-width: 1200px; margin: 0 auto; }
header { display: flex; flex-wrap: wrap; gap: .75rem 1rem; align-items: baseline; margin-bottom: 1.5rem; }
h1 { font-size: 1.25rem; margin: 0; letter-spacing: .04em; }
.meta { color: var(--dim); font-size: .8125rem; }
.warning { color: var(--warn); font-size: .8125rem; width: 100%; }
.actions { margin-left: auto; display: flex; gap: .5rem; align-items: center; }
input[type=search] {
  font: inherit; padding: .35rem .6rem; border: 1px solid var(--line);
  border-radius: 6px; background: var(--panel); color: var(--fg); min-width: 14rem;
}
.btn {
  font: inherit; padding: .35rem .75rem; border: 1px solid var(--line); border-radius: 6px;
  background: var(--panel); color: var(--fg); text-decoration: none; cursor: pointer;
}
.btn:hover { border-color: var(--accent); color: var(--accent); }
section { margin-bottom: 2rem; }
h2 { font-size: .875rem; margin: 0 0 .25rem; text-transform: lowercase; letter-spacing: .03em; }
.note { color: var(--dim); font-size: .8125rem; margin: 0 0 .6rem; }
.line { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8125rem; margin: .2rem 0; word-break: break-word; }
table { border-collapse: collapse; width: 100%; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8125rem; }
th, td { text-align: left; padding: .3rem .6rem .3rem 0; border-bottom: 1px solid var(--line); white-space: nowrap; }
th { color: var(--dim); font-weight: 500; cursor: pointer; user-select: none; }
th:hover { color: var(--fg); }
th.right, td.right { text-align: right; }
td:last-child { white-space: normal; width: 99%; }
a { color: inherit; text-decoration: none; border-bottom: 1px solid var(--line); }
a:hover { color: var(--accent); border-color: var(--accent); }
.t-dim { color: var(--dim); }
.t-good { color: var(--good); }
.t-warn { color: var(--warn); }
.t-bad { color: var(--bad); }
.t-accent { color: var(--accent); }
tr.hidden { display: none; }
footer { color: var(--dim); font-size: .75rem; margin-top: 3rem; }
`;

const JS = `
document.querySelectorAll('table.sortable th').forEach(function (th) {
  th.addEventListener('click', function () {
    var table = th.closest('table');
    var idx = Number(th.dataset.col);
    var body = table.tBodies[0];
    var rows = Array.prototype.slice.call(body.rows);
    var dir = th.dataset.dir === 'asc' ? -1 : 1;
    table.querySelectorAll('th').forEach(function (o) { delete o.dataset.dir; });
    th.dataset.dir = dir === 1 ? 'asc' : 'desc';
    rows.sort(function (a, b) {
      var ca = a.cells[idx], cb = b.cells[idx];
      var va = ca && ca.dataset.sort !== undefined ? ca.dataset.sort : (ca ? ca.textContent.trim() : '');
      var vb = cb && cb.dataset.sort !== undefined ? cb.dataset.sort : (cb ? cb.textContent.trim() : '');
      var na = parseFloat(va), nb = parseFloat(vb);
      if (!isNaN(na) && !isNaN(nb) && va !== '' && vb !== '') return (na - nb) * dir;
      return va.localeCompare(vb) * dir;
    });
    rows.forEach(function (r) { body.appendChild(r); });
  });
});

var filter = document.getElementById('filter');
if (filter) {
  filter.addEventListener('input', function () {
    var q = filter.value.toLowerCase();
    document.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.classList.toggle('hidden', q !== '' && tr.textContent.toLowerCase().indexOf(q) === -1);
    });
  });
  filter.focus();
}
`;

export function renderHtml(view: View, opts: { refreshable?: boolean } = {}): string {
  const refresh = opts.refreshable ? `<a class="btn" href="/?refresh=1">refresh</a>` : "";
  const warning = view.warning ? `<div class="warning">! ${esc(view.warning)}</div>` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(view.title)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ctext y='13' font-size='13'%3E%F0%9F%97%84%3C/text%3E%3C/svg%3E">
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>${esc(view.title)}</h1>
  <span class="meta">${esc(view.meta)}</span>
  <span class="actions">
    <input type="search" id="filter" placeholder="filter…" autocomplete="off">
    ${refresh}
  </span>
  ${warning}
</header>
${view.sections.map(sectionHtml).join("\n")}
<footer>generated by shelf · click a column header to sort</footer>
</div>
<script>${JS}</script>
</body>
</html>
`;
}

/**
 * Ephemeral server: random port on loopback only, opens the browser, lives
 * until Ctrl-C. It exists so the page can have a working refresh button;
 * `index -o file.html` is the static path for anything you want to keep.
 */
export async function serveView(
  build: (force: boolean) => Promise<View>,
  opts: { open?: boolean } = {},
): Promise<never> {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/") return new Response("not found", { status: 404 });
      try {
        const view = await build(url.searchParams.get("refresh") === "1");
        return new Response(renderHtml(view, { refreshable: true }), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return new Response(`<pre>${esc(msg)}</pre>`, {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
    },
  });

  const url = `http://127.0.0.1:${server.port}`;
  console.error(`shelf → ${url}  (ctrl-c to stop)`);
  if (opts.open !== false) {
    const open = Bun.which("open");
    if (open) Bun.spawn([open, url], { stdout: "ignore", stderr: "ignore" });
  }

  await new Promise<never>(() => {});
  throw new Error("unreachable");
}
