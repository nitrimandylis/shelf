import type { View } from "./views.ts";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Embedded JSON must not be able to close its own script tag, and must not
 * carry raw line separators that would break the surrounding script.
 */
export function jsonScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const CSS = `
:root {
  --bg: oklch(99% 0.002 250);
  --surface: oklch(97% 0.004 250);
  --raised: oklch(94.5% 0.006 250);
  --ink: oklch(23% 0.012 250);
  --muted: oklch(50% 0.015 250);
  --line: oklch(91% 0.005 250);
  --accent: oklch(52% 0.17 255);
  --good: oklch(48% 0.13 150);
  --warn: oklch(52% 0.13 70);
  --bad: oklch(52% 0.19 25);
  --shadow: 0 1px 2px oklch(23% 0.012 250 / 0.06);
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
  --z-sticky: 100;
  --z-tooltip: 300;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: oklch(16% 0.008 250);
    --surface: oklch(20% 0.010 250);
    --raised: oklch(24% 0.012 250);
    --ink: oklch(93% 0.006 250);
    --muted: oklch(66% 0.014 250);
    --line: oklch(28% 0.010 250);
    --accent: oklch(74% 0.14 255);
    --good: oklch(76% 0.14 150);
    --warn: oklch(80% 0.13 80);
    --bad: oklch(72% 0.16 20);
    --shadow: 0 1px 2px oklch(0% 0 0 / 0.3);
  }
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 0.9375rem/1.5 ui-sans-serif, -apple-system, system-ui, "Segoe UI", sans-serif;
  font-variant-numeric: tabular-nums;
  overflow-x: hidden;
}
.wrap { max-width: 1400px; margin: 0 auto; padding: 0 1.25rem 5rem; }

/* ---------------------------------------------------------------- header */
header {
  position: sticky; top: 0; z-index: var(--z-sticky);
  background: color-mix(in oklch, var(--bg) 88%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line);
  margin: 0 -1.25rem 1rem;
  padding: 0.875rem 1.25rem 0;
}
.bar { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: baseline; }
h1 {
  font-size: 1.125rem; margin: 0; letter-spacing: 0.06em; font-weight: 620;
}
.meta { color: var(--muted); font-size: 0.75rem; }
.controls { margin-left: auto; display: flex; gap: 0.5rem; align-items: center; }
.warning {
  width: 100%; color: var(--warn); font-size: 0.8125rem;
  margin-top: 0.375rem;
}

input[type=search], select, button.btn {
  font: inherit; font-size: 0.8125rem;
  padding: 0.3rem 0.55rem;
  border: 1px solid var(--line); border-radius: 6px;
  background: var(--surface); color: var(--ink);
  transition: border-color 0.15s var(--ease), background 0.15s var(--ease);
}
input[type=search] { min-width: 13rem; }
input[type=search]::placeholder { color: var(--muted); opacity: 1; }
button.btn { cursor: pointer; }
button.btn:hover:not(:disabled), input[type=search]:hover, select:hover { border-color: var(--muted); }
button.btn:active:not(:disabled) { background: var(--raised); }
button.btn:disabled { opacity: 0.6; cursor: default; }
:where(input, select, button, a, tr):focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px;
}
label.sel-label { display: flex; align-items: center; gap: 0.35rem; font-size: 0.75rem; color: var(--muted); }

/* progress: a refresh takes 9-11s and must never look like a frozen page */
.progress { height: 2px; margin: 0.75rem -1.25rem 0; overflow: hidden; background: transparent; }
.progress.on { background: var(--line); }
.progress.on::after {
  content: ""; display: block; height: 100%; width: 35%;
  background: var(--accent); animation: slide 1.1s infinite var(--ease);
}
@keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(385%); } }

/* ---------------------------------------------------------------- facets */
.facets { display: flex; flex-wrap: wrap; gap: 0.375rem; padding: 0.625rem 0 0.75rem; }
.chip {
  font: inherit; font-size: 0.75rem; cursor: pointer;
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.2rem 0.5rem; border-radius: 999px;
  border: 1px solid var(--line); background: transparent; color: var(--muted);
  transition: color 0.15s var(--ease), border-color 0.15s var(--ease), background 0.15s var(--ease);
}
.chip:hover { color: var(--ink); border-color: var(--muted); }
.chip[aria-pressed="true"] {
  background: color-mix(in oklch, var(--accent) 14%, transparent);
  border-color: var(--accent); color: var(--ink);
}
.chip .n { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink); }
.chip.warn .n { color: var(--warn); }

/* ---------------------------------------------------------------- table */
section { margin-bottom: 2rem; }
h2 {
  font-size: 0.9375rem; margin: 0 0 0.125rem; font-weight: 600;
}
h2 .desc { font-weight: 400; color: var(--muted); }
.note { color: var(--muted); font-size: 0.8125rem; margin: 0 0 0.5rem; }
/* No overflow wrapper here on purpose: an overflow-x:auto ancestor becomes the
   scrollport for position:sticky descendants and silently kills the sticky
   column headers. The table is kept inside the viewport by dropping columns at
   breakpoints and letting the last column wrap instead. */
table { border-collapse: collapse; width: 100%; table-layout: auto; }
thead th {
  position: sticky; top: var(--head-h, 3.25rem); z-index: 1;
  background: var(--bg);
  text-align: left; font-weight: 500; font-size: 0.6875rem;
  color: var(--muted); letter-spacing: 0.03em;
  padding: 0.35rem 0.75rem 0.35rem 0; border-bottom: 1px solid var(--line);
  cursor: pointer; user-select: none; white-space: nowrap;
}
thead th:hover { color: var(--ink); }
thead th .dir { opacity: 0; }
thead th[data-dir] .dir { opacity: 1; }
td {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125rem;
  padding: 0.3rem 0.75rem 0.3rem 0;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
th.right, td.right { text-align: right; padding-right: 0.75rem; }
td:last-child, th:last-child { white-space: normal; width: 99%; padding-right: 0; overflow-wrap: anywhere; }
tbody tr { transition: background 0.12s var(--ease); }
tbody tr:hover { background: var(--surface); }
tbody tr[aria-selected="true"] { background: color-mix(in oklch, var(--accent) 12%, var(--bg)); }
tr.group-head td {
  font-family: inherit; font-size: 0.6875rem; letter-spacing: 0.04em;
  color: var(--muted); padding-top: 1rem; border-bottom: 1px solid var(--line);
}
tr.group-head .n { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

a { color: inherit; text-decoration: none; border-bottom: 1px solid var(--line); }
a:hover { color: var(--accent); border-color: currentColor; }

.dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 0.45rem; vertical-align: 0.06em; background: currentColor; }
.t-dim { color: var(--muted); }
.t-good { color: var(--good); }
.t-warn { color: var(--warn); }
.t-bad { color: var(--bad); }
.t-accent { color: var(--accent); }

/* activity chart */
.spark { display: block; overflow: visible; }
.spark rect { fill: var(--accent); opacity: 0.75; transition: opacity 0.12s var(--ease); }
.spark rect.zero { fill: var(--muted); opacity: 0.3; }
.spark:hover rect { opacity: 0.4; }
.spark rect:hover { opacity: 1; }

/* ---------------------------------------------------------------- kinds */
.facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.3rem 1.5rem; }
.facts dt { color: var(--muted); font-size: 0.75rem; padding-top: 0.1rem; }
.facts dd {
  margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125rem; word-break: break-word;
}
.timeline { list-style: none; margin: 0; padding: 0; }
.timeline li {
  display: grid; grid-template-columns: 3.5rem minmax(0, 1fr); gap: 1rem;
  padding: 0.3rem 0; border-bottom: 1px solid var(--line);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8125rem;
}
.timeline .when { color: var(--muted); text-align: right; }
.line { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8125rem; margin: 0.2rem 0; word-break: break-word; }
section.clean { margin-bottom: 0.75rem; }
section.clean h2 { display: inline; font-size: 0.8125rem; font-weight: 500; color: var(--muted); }
section.clean .tick { color: var(--good); margin-left: 0.5rem; font-size: 0.8125rem; }
section.clean .note { display: none; }

.empty { color: var(--muted); font-size: 0.875rem; padding: 2.5rem 0; text-align: center; }
.empty strong { color: var(--ink); display: block; margin-bottom: 0.25rem; font-weight: 550; }
footer { color: var(--muted); font-size: 0.75rem; margin-top: 3rem; border-top: 1px solid var(--line); padding-top: 0.75rem; }
kbd {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.6875rem;
  border: 1px solid var(--line); border-radius: 4px; padding: 0.05rem 0.3rem; color: var(--ink);
}

/* responsive: drop columns by priority, never squeeze the table */
@media (max-width: 1100px) { [data-drop="3"] { display: none; } }
@media (max-width: 900px)  { [data-drop="2"] { display: none; } }
@media (max-width: 760px)  {
  .controls { margin-left: 0; width: 100%; }
  input[type=search] { flex: 1; min-width: 0; }
}
/* Phone width: the chart is the last thing to go, and the gutters tighten,
   because the table's minimum content width still has to fit the viewport. */
@media (max-width: 520px) {
  [data-drop="1"] { display: none; }
  .wrap { padding-left: 0.75rem; padding-right: 0.75rem; }
  header { margin-left: -0.75rem; margin-right: -0.75rem; padding-left: 0.75rem; padding-right: 0.75rem; }
  .progress { margin-left: -0.75rem; margin-right: -0.75rem; }
  td, th { padding-right: 0.5rem; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
  .progress.on::after { width: 100%; animation: none; }
}
`;

// Client renderer. Consumes the same View model the terminal renderer does, so
// the two cannot drift. Written without template literals to keep it readable
// inside a TS template string.
const JS = `
(function () {
  var payload = document.getElementById('shelf-data');
  if (!payload) return;
  var view = JSON.parse(payload.textContent);
  var root = document.getElementById('views');
  var state = { q: '', facets: {}, group: '', sort: null, dir: 1, sel: -1 };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function toneClass(t) { return t && t !== 'plain' ? 't-' + t : ''; }

  function sparkSvg(bars, big) {
    var NS = 'http://www.w3.org/2000/svg';
    var max = Math.max.apply(null, bars);
    var w = big ? 14 : 5, gap = big ? 4 : 2, h = big ? 48 : 16;
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'spark');
    svg.setAttribute('width', String(bars.length * (w + gap) - gap));
    svg.setAttribute('height', String(h));
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', bars.reduce(function (a, b) { return a + b; }, 0) + ' commits over 8 weeks');
    for (var i = 0; i < bars.length; i++) {
      var v = bars[i];
      var bh = max > 0 && v > 0 ? Math.max(2, Math.round((v / max) * h)) : 1;
      var r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', String(i * (w + gap)));
      r.setAttribute('y', String(h - bh));
      r.setAttribute('width', String(w));
      r.setAttribute('height', String(bh));
      if (!v) r.setAttribute('class', 'zero');
      var ago = bars.length - 1 - i;
      var t = document.createElementNS(NS, 'title');
      t.textContent = v + (v === 1 ? ' commit' : ' commits') + ' \\u00b7 ' + (ago === 0 ? 'this week' : ago + ' week' + (ago === 1 ? '' : 's') + ' ago');
      r.appendChild(t);
      svg.appendChild(r);
    }
    return svg;
  }

  function cellNode(cell, col) {
    var td = el('td', (col && col.align === 'right' ? 'right ' : '') + toneClass(cell.tone));
    if (col && col.drop) td.setAttribute('data-drop', String(col.drop));
    if (cell.bars) { td.appendChild(sparkSvg(cell.bars, cell.bigBars)); return td; }
    if (cell.dot) {
      var d = el('span', 'dot ' + toneClass(cell.dot));
      d.setAttribute('aria-hidden', 'true');
      td.appendChild(d);
    }
    // cell.label is the browser wording; cell.text keeps the terminal glyphs.
    var text = cell.label !== undefined ? cell.label : cell.text;
    if (cell.href) {
      var a = el('a', null, text);
      a.href = cell.href; a.target = '_blank'; a.rel = 'noreferrer';
      td.appendChild(a);
    } else {
      td.appendChild(document.createTextNode(text));
    }
    return td;
  }

  function rowMatches(row) {
    for (var f in state.facets) {
      if (!state.facets[f]) continue;
      if (!row.facets || row.facets[f] !== state.facets[f]) return false;
    }
    if (!state.q) return true;
    var hay = row.cells.map(function (c) { return c.text; }).join(' ').toLowerCase();
    return hay.indexOf(state.q) !== -1;
  }

  function sortRows(rows) {
    if (state.sort === null) return rows;
    var i = state.sort, dir = state.dir;
    return rows.slice().sort(function (a, b) {
      var ca = a.cells[i] || {}, cb = b.cells[i] || {};
      var va = ca.sort !== undefined ? ca.sort : ca.text;
      var vb = cb.sort !== undefined ? cb.sort : cb.text;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }

  function renderTable(section, host) {
    var rows = section.rows.filter(rowMatches);
    var table = el('table');
    var thead = el('thead');
    var htr = el('tr');
    var showHead = section.columns.some(function (c) { return c.label !== ''; });

    section.columns.forEach(function (col, i) {
      var th = el('th', col.align === 'right' ? 'right' : null);
      if (col.drop) th.setAttribute('data-drop', String(col.drop));
      th.appendChild(document.createTextNode(col.label));
      var dir = el('span', 'dir', state.sort === i ? (state.dir === 1 ? ' \\u2191' : ' \\u2193') : ' \\u2191');
      th.appendChild(dir);
      if (state.sort === i) th.setAttribute('data-dir', state.dir === 1 ? 'asc' : 'desc');
      th.setAttribute('scope', 'col');
      th.tabIndex = 0;
      function doSort() {
        if (state.sort === i) { state.dir = -state.dir; } else { state.sort = i; state.dir = 1; }
        render();
      }
      th.addEventListener('click', doSort);
      th.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doSort(); } });
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    if (showHead) table.appendChild(thead);

    var tbody = el('tbody');
    var ordered = sortRows(rows);

    if (state.group) {
      var buckets = {};
      var order = [];
      ordered.forEach(function (r) {
        var k = (r.facets && r.facets[state.group]) || '—';
        if (!buckets[k]) { buckets[k] = []; order.push(k); }
        buckets[k].push(r);
      });
      order.sort(function (a, b) { return buckets[b].length - buckets[a].length || a.localeCompare(b); });
      order.forEach(function (k) {
        var gtr = el('tr', 'group-head');
        var gtd = el('td');
        gtd.colSpan = section.columns.length;
        gtd.appendChild(document.createTextNode(k + ' '));
        gtd.appendChild(el('span', 'n', String(buckets[k].length)));
        gtr.appendChild(gtd);
        tbody.appendChild(gtr);
        buckets[k].forEach(function (r) { tbody.appendChild(rowNode(r, section)); });
      });
    } else {
      ordered.forEach(function (r) { tbody.appendChild(rowNode(r, section)); });
    }

    table.appendChild(tbody);
    host.appendChild(table);
    return rows.length;
  }

  function rowNode(row, section) {
    var tr = el('tr');
    tr.tabIndex = -1;
    row.cells.forEach(function (c, i) { tr.appendChild(cellNode(c, section.columns[i])); });
    var link = row.cells.filter(function (c) { return c.href; })[0];
    if (link) tr.setAttribute('data-href', link.href);
    return tr;
  }

  function renderSection(section) {
    var sec = el('section', section.clean ? 'clean' : null);
    if (section.title) {
      var h = el('h2');
      var split = section.title.split(' \\u2014 ');
      h.appendChild(document.createTextNode(split[0]));
      if (split.length > 1) {
        var d = el('span', 'desc', ' \\u2014 ' + split.slice(1).join(' \\u2014 '));
        h.appendChild(d);
      }
      sec.appendChild(h);
      if (section.clean) sec.appendChild(el('span', 'tick', '\\u2713 nothing'));
    }
    if (section.note) sec.appendChild(el('p', 'note', section.note));

    var kind = section.kind || (section.columns ? 'table' : 'lines');
    var shown = section.rows.length;

    if (section.clean) { return sec; }
    if (kind === 'facts') {
      var dl = el('dl', 'facts');
      section.rows.forEach(function (r) {
        dl.appendChild(el('dt', null, r.cells[0].text));
        var dd = el('dd', toneClass(r.cells[1].tone));
        if (r.cells[1].href) {
          var a = el('a', null, r.cells[1].text);
          a.href = r.cells[1].href; a.target = '_blank'; a.rel = 'noreferrer';
          dd.appendChild(a);
        } else { dd.textContent = r.cells[1].text; }
        dl.appendChild(dd);
      });
      sec.appendChild(dl);
    } else if (kind === 'timeline') {
      var ul = el('ul', 'timeline');
      section.rows.forEach(function (r) {
        var li = el('li');
        li.appendChild(el('span', 'when', r.cells[0].text));
        li.appendChild(el('span', null, r.cells[1].text));
        ul.appendChild(li);
      });
      sec.appendChild(ul);
    } else if (kind === 'lines') {
      section.rows.forEach(function (r) {
        sec.appendChild(el('p', 'line ' + toneClass(r.cells[0].tone), r.cells.map(function (c) { return c.text; }).join(' ')));
      });
    } else {
      shown = renderTable(section, sec);
    }
    return { node: sec, shown: shown };
  }

  function render() {
    root.textContent = '';
    var total = 0;
    view.sections.forEach(function (s) {
      var out = renderSection(s);
      var node = out.node || out;
      total += out.shown === undefined ? s.rows.length : out.shown;
      root.appendChild(node);
    });

    if (total === 0) {
      var e = el('div', 'empty');
      e.appendChild(el('strong', null, 'Nothing matches'));
      e.appendChild(document.createTextNode('Clear the filter or a chip to see all ' + countAll() + ' repos.'));
      root.appendChild(e);
    }
    state.sel = -1;
    updateMeta();
    measureHeader();
  }

  function countAll() {
    return view.sections.reduce(function (a, s) { return a + s.rows.length; }, 0);
  }

  function updateMeta() {
    var m = document.getElementById('meta');
    if (m) m.textContent = view.meta;
    // A refresh can succeed at the HTTP level and still be serving cached data
    // (GitHub 5xx, no network). The payload says so; the page must repeat it,
    // or stale data looks current.
    var w = document.getElementById('warning');
    if (!w) return;
    if (view.warning) { w.textContent = '! ' + view.warning; w.hidden = false; }
    else { w.textContent = ''; w.hidden = true; }
  }

  function visibleRows() {
    return Array.prototype.slice.call(root.querySelectorAll('tbody tr:not(.group-head)'));
  }

  function moveSel(delta) {
    var rows = visibleRows();
    if (!rows.length) return;
    rows.forEach(function (r) { r.removeAttribute('aria-selected'); });
    state.sel = Math.max(0, Math.min(rows.length - 1, state.sel + delta));
    var r = rows[state.sel];
    r.setAttribute('aria-selected', 'true');
    r.scrollIntoView({ block: 'nearest' });
  }

  // ------------------------------------------------------------ controls
  var filter = document.getElementById('filter');
  filter.addEventListener('input', function () { state.q = filter.value.toLowerCase().trim(); render(); });

  var group = document.getElementById('group');
  if (group) group.addEventListener('change', function () { state.group = group.value; render(); });

  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (chip) {
    chip.addEventListener('click', function () {
      var f = chip.getAttribute('data-field'), v = chip.getAttribute('data-value');
      var on = state.facets[f] === v;
      if (on) { delete state.facets[f]; } else { state.facets[f] = v; }
      chip.setAttribute('aria-pressed', on ? 'false' : 'true');
      render();
    });
  });

  var refresh = document.getElementById('refresh');
  var progress = document.getElementById('progress');
  if (refresh) {
    refresh.addEventListener('click', function () {
      refresh.disabled = true;
      refresh.textContent = 'refreshing\\u2026';
      progress.className = 'progress on';
      fetch(refresh.getAttribute('data-url'), { headers: { accept: 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (fresh) { view = fresh; render(); })
        .catch(function (err) {
          view.warning = 'refresh failed: ' + err.message;
          render();
        })
        .then(function () {
          refresh.disabled = false;
          refresh.textContent = 'refresh';
          progress.className = 'progress';
        });
    });
  }

  document.addEventListener('keydown', function (e) {
    var typing = document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); filter.focus(); filter.select(); return; }
    if (e.key === 'Escape') {
      if (typing) { filter.value = ''; state.q = ''; filter.blur(); render(); }
      return;
    }
    if (typing) return;
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
    else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
    else if (e.key === 'Enter') {
      var rows = visibleRows();
      var r = rows[state.sel];
      if (r && r.getAttribute('data-href')) window.open(r.getAttribute('data-href'), '_blank', 'noreferrer');
    }
  });

  function measureHeader() {
    var h = document.querySelector('header');
    if (h) document.documentElement.style.setProperty('--head-h', h.offsetHeight + 'px');
  }
  window.addEventListener('resize', measureHeader);

  render();
  measureHeader();
})();
`;

function facetsHtml(view: View): string {
  if (!view.facets?.length) return "";
  const chips = view.facets
    .map(
      (f) =>
        `<button class="chip ${f.tone === "warn" ? "warn" : ""}" type="button" aria-pressed="false"` +
        ` data-field="${esc(f.field)}" data-value="${esc(f.value)}">` +
        `${esc(f.label)} <span class="n">${f.count}</span></button>`,
    )
    .join("");
  return `<div class="facets">${chips}</div>`;
}

function groupHtml(view: View): string {
  if (!view.groupBy?.length) return "";
  const opts = [`<option value="">none</option>`]
    .concat(view.groupBy.map((g) => `<option value="${esc(g.field)}">${esc(g.label)}</option>`))
    .join("");
  return `<label class="sel-label">group <select id="group">${opts}</select></label>`;
}

export function renderHtml(
  view: View,
  opts: { refreshable?: boolean; dataUrl?: string } = {},
): string {
  const refresh = opts.refreshable
    ? `<button class="btn" id="refresh" type="button" data-url="${esc(opts.dataUrl ?? "/api/data?refresh=1")}">refresh</button>`
    : "";

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
  <div class="bar">
    <h1>${esc(view.title)}</h1>
    <span class="meta" id="meta">${esc(view.meta)}</span>
    <span class="controls">
      <input type="search" id="filter" placeholder="filter…  (press /)" autocomplete="off" spellcheck="false" aria-label="Filter rows">
      ${groupHtml(view)}
      ${refresh}
    </span>
    <div class="warning" id="warning"${view.warning ? "" : " hidden"}>${view.warning ? "! " + esc(view.warning) : ""}</div>
  </div>
  <div class="progress" id="progress"></div>
</header>
${facetsHtml(view)}
<main id="views"></main>
<footer>
  <kbd>/</kbd> filter · <kbd>j</kbd><kbd>k</kbd> move · <kbd>enter</kbd> open · <kbd>esc</kbd> clear · click a column to sort
</footer>
</div>
<script type="application/json" id="shelf-data">${jsonScript(view)}</script>
<script>${JS}</script>
</body>
</html>
`;
}

/**
 * Ephemeral server: random port on loopback only, opens the browser, lives
 * until Ctrl-C. `/api/data` returns the view model as JSON so the refresh
 * button can swap data in place instead of reloading a page that would then
 * stall for the length of a cold GitHub fetch.
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
      const force = url.searchParams.get("refresh") === "1";

      try {
        if (url.pathname === "/api/data") {
          return Response.json(await build(force));
        }
        if (url.pathname === "/") {
          return new Response(renderHtml(await build(force), { refreshable: true }), {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        return new Response("not found", { status: 404 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (url.pathname === "/api/data") {
          return Response.json({ error: msg }, { status: 500 });
        }
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
