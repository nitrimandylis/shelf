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
/* Monochrome structure, ANSI-16 accents. Colour only ever carries meaning:
   nothing decorative on this page is coloured. Dark is the real design; the
   light variant is the daylight fallback. */
:root {
  --bg: #0a0a0b;
  --surface: #131316;
  --raised: #1b1b1f;
  --line: #2c2c31;
  --line-bright: #3d3d44;
  --ink: #e9e9ec;
  --dim: #9a9aa2;
  --green: #7ec96b;
  --yellow: #e0b252;
  --red: #ec6a6a;
  --cyan: #5cc2d6;
  --sel: #1e2a30;
  --fs: 15px;
  --lh: 24px;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
  /* iOS drawer curve: strong ease-out, no built-in easing is punchy enough */
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
  --drawer-w: min(150ch, 54vw);
  --z-sticky: 100;
  color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #fbfbfa;
    --surface: #f2f2ef;
    --raised: #e8e8e4;
    --line: #d3d3ce;
    --line-bright: #b4b4ae;
    --ink: #16161a;
    --dim: #5c5c64;
    --green: #2f7d24;
    --yellow: #8a5c00;
    --red: #bc2f2e;
    --cyan: #0f6c80;
    --sel: #e3edf1;
    color-scheme: light;
  }
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--fs);
  line-height: var(--lh);
  font-variant-numeric: tabular-nums;
  font-variant-ligatures: none;
  overflow-x: hidden;
}
/* The drawer is a grid column, not an overlay, so opening it genuinely narrows
   the table instead of covering it. */
/* overflow-x: clip, not hidden: clip does not create a scroll container, so the
   sticky header inside .main keeps working. */
.page { display: grid; grid-template-columns: minmax(0, 1fr) 0px; overflow-x: clip; }
.page.open { grid-template-columns: minmax(0, 1fr) var(--drawer-w); }
.main { min-width: 0; container-type: inline-size; container-name: main; }
.wrap { max-width: 132ch; margin: 0 auto; padding: 2ch 2ch 6ch; }

/* ------------------------------------------------------------- framing */
/* CSS borders rather than literal box-drawing characters: same look, but it
   survives reflow and never lands in copy-paste or a screen reader. */
.frame { border: 1px solid var(--line); position: relative; }
.legend {
  position: absolute; top: 0; left: 2ch; transform: translateY(-50%);
  background: var(--bg); padding: 0 1ch; margin: 0;
  font-size: var(--fs); font-weight: 700; letter-spacing: 0.12em;
}
.legend .sub { font-weight: 400; letter-spacing: 0; color: var(--dim); }

header { position: sticky; top: 0; z-index: var(--z-sticky); background: var(--bg); padding-top: 1px; }
header .frame { padding: 1.2ch 2ch 1ch; }
.bar { display: flex; flex-wrap: wrap; gap: 0.5ch 2ch; align-items: center; }
.meta { color: var(--dim); }
.controls { margin-left: auto; display: flex; gap: 1ch; align-items: center; }
.warning { width: 100%; color: var(--yellow); margin-top: 0.5ch; }

/* ------------------------------------------------------------- controls */
input[type=search], select, button.btn, .chip {
  font: inherit; font-family: inherit;
  background: transparent; color: var(--ink);
  border: 1px solid var(--line); border-radius: 0;
  padding: 0 1ch; height: var(--lh); line-height: calc(var(--lh) - 2px);
  transition: border-color 0.12s var(--ease), color 0.12s var(--ease), background 0.12s var(--ease);
}
input[type=search] { min-width: 24ch; }
input[type=search]::placeholder { color: var(--dim); opacity: 1; }
button.btn, .chip, select { cursor: pointer; }
button.btn:hover:not(:disabled), input[type=search]:hover, select:hover, .chip:hover {
  border-color: var(--line-bright); color: var(--ink);
}
button.btn:active:not(:disabled) { background: var(--raised); }
button.btn:disabled { color: var(--dim); cursor: default; }
:where(input, select, button, a, tr):focus-visible {
  outline: 1px solid var(--cyan); outline-offset: 1px;
}
.sel-label { color: var(--dim); display: inline-flex; align-items: center; gap: 1ch; }

.progress { height: 1px; background: transparent; margin-top: 1ch; }
.progress.on { background: var(--line); overflow: hidden; }
.progress.on::after {
  content: ""; display: block; height: 100%; width: 30%;
  background: var(--cyan); animation: slide 1.1s infinite linear;
}
@keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(433%); } }

/* ------------------------------------------------------------- facets */
.facets { display: flex; flex-wrap: wrap; gap: 1ch; margin: 2ch 0 1ch; }
.chip { border-color: transparent; color: var(--dim); padding: 0 1ch 0 0; }
.chip .box { color: var(--dim); }
.chip[aria-pressed="true"] { color: var(--ink); }
.chip[aria-pressed="true"] .box { color: var(--cyan); }
.chip .n { color: var(--ink); }
.chip.warn .n { color: var(--yellow); }

/* ------------------------------------------------------------- sections */
section { margin: 3ch 0; }
section .frame { padding: 1.5ch 2ch 1ch; }
h2 { font-size: var(--fs); margin: 0; font-weight: 700; letter-spacing: 0.06em; }
h2 .desc { font-weight: 400; letter-spacing: 0; color: var(--dim); }
.note { color: var(--dim); margin: 0 0 1ch; }

/* width: auto, not 100%. With 100% the last column absorbed all slack — on a
   wide screen the mostly-empty note column ran to 543px while the data crammed
   left. Sizing to content is what a terminal table does. */
table { border-collapse: collapse; width: auto; max-width: 100%; }
thead th {
  position: sticky; top: var(--head-h, 6ch); z-index: 1; background: var(--bg);
  text-align: left; font-weight: 400; color: var(--dim);
  padding: 0 2ch 0 0; border-bottom: 1px solid var(--line);
  cursor: pointer; user-select: none; white-space: nowrap; height: var(--lh);
}
thead th:hover { color: var(--ink); }
thead th .dir { visibility: hidden; }
thead th[data-dir] .dir { visibility: visible; color: var(--cyan); }
td {
  padding: 0 2ch 0 0; white-space: nowrap; height: var(--lh);
  border-bottom: 1px solid transparent;
}
th.right, td.right { text-align: right; padding-right: 2ch; }
td:last-child, th:last-child { white-space: normal; max-width: 48ch; padding-right: 0; overflow-wrap: break-word; }
tbody tr { transition: background 0.1s var(--ease); }
tbody tr:hover { background: var(--surface); }
tbody tr[aria-selected="true"] { background: var(--sel); }
tbody tr[aria-selected="true"] td:first-child { box-shadow: inset 2px 0 0 var(--cyan); }
tr.group-head td {
  color: var(--dim); padding-top: 1.5ch; border-bottom: 1px solid var(--line);
  letter-spacing: 0.08em;
}

a { color: inherit; text-decoration: none; border-bottom: 1px solid var(--line); }
a:hover { color: var(--cyan); border-color: currentColor; }

/* tone is the only coloured thing on the page */
.t-dim { color: var(--dim); }
.t-good { color: var(--green); }
.t-warn { color: var(--yellow); }
.t-bad { color: var(--red); }
.t-accent { color: var(--ink); }
td.t-accent a { color: var(--ink); }

/* activity chart: SVG, but locked to whole character cells so the column is
   exactly 8ch wide and lines up with everything else. */
.spark { display: inline-block; vertical-align: -0.18em; }
/* Bar height is the data, so the bars are monochrome: spending the accent
   colour here would be decoration. Cyan means interaction, nothing else. */
.spark rect { fill: var(--ink); shape-rendering: crispEdges; }
.spark rect.zero { fill: var(--line-bright); }
.spark:hover rect { fill: var(--line-bright); }
.spark rect:hover { fill: var(--cyan); }

/* ------------------------------------------------------------- kinds */
.facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0 3ch; }
.facts dt { color: var(--dim); }
.facts dd { margin: 0; word-break: break-word; }
.timeline { list-style: none; margin: 0; padding: 0; }
.timeline li { display: grid; grid-template-columns: 6ch minmax(0, 1fr); gap: 2ch; }
.timeline .when { color: var(--dim); text-align: right; }
.line { margin: 0; word-break: break-word; }
section.clean { margin: 1ch 0; }
section.clean .frame { border-color: transparent; padding: 0 2ch; }
section.clean h2 { display: inline; font-weight: 400; color: var(--dim); letter-spacing: 0; }
section.clean .legend { display: none; }
section.clean .tick { color: var(--green); margin-left: 1ch; }
section.clean .note { display: none; }

/* ------------------------------------------------------------- drawer */
/* A panel, not a modal: the table stays visible and keeps its selection, so
   j/k walks the list with the card following along. */
.drawer {
  position: sticky; top: 0;
  height: 100vh; overflow-y: auto; overscroll-behavior: contain;
  background: var(--bg);
  border-left: 1px solid var(--line);
  padding: 2ch;
  /* Fixed inner width so the panel is revealed by the growing column rather
     than reflowing its own contents on every frame. */
  width: var(--drawer-w);
  /* start, so a collapsed 0px column parks the panel off-screen to the right
     rather than overflowing leftward across the table. */
  justify-self: start;
}
/* Laid out but inert while closed, or an invisible panel would swallow clicks. */
.drawer[hidden] { display: block; pointer-events: none; }
.drawer > .frame { padding: 2ch; min-height: calc(100vh - 4ch); }
/* keep the title clear of the close button */
.drawer section:first-child h2 { padding-right: 9ch; }
.drawer section > .frame { padding: 0; border: 0; min-height: 0; }
.drawer-close { position: absolute; top: 1ch; right: 1ch; z-index: 1; border-color: transparent; color: var(--dim); }
.drawer-close:hover { color: var(--ink); }
.drawer section { margin: 0 0 2.5ch; }
.drawer section .frame { padding: 0; border: 0; }
.drawer h2 { position: static; transform: none; background: none; padding: 0 0 0.5ch; color: var(--dim); font-weight: 400; letter-spacing: 0.08em; border-bottom: 1px solid var(--line); }
.drawer .legend { position: static; transform: none; background: none; padding: 0 0 0.5ch; }
.drawer .loading { color: var(--dim); padding: 2ch 0; }
/* Motion. The column width is the layout change; the panel rides it with a
   short translate so it reads as sliding in rather than being unveiled. */
@media (prefers-reduced-motion: no-preference) {
  .page { transition: grid-template-columns 280ms var(--ease-drawer); }
  .drawer { transition: opacity 200ms var(--ease-drawer), transform 280ms var(--ease-drawer); }
  .drawer[hidden] { opacity: 0; transform: translateX(2ch); }
  .page.open .drawer { opacity: 1; transform: translateX(0); }
}
/* Reduced motion keeps the opacity change (it aids comprehension) and drops
   every movement, per the accessibility rule. */
@media (prefers-reduced-motion: reduce) {
  .drawer { transition: opacity 120ms linear; }
  .drawer[hidden] { opacity: 0; }
}

/* readme */
.md { overflow-wrap: break-word; }
.md h1, .md h2, .md h3, .md h4, .md h5, .md h6 {
  font-size: var(--fs); font-weight: 700; letter-spacing: 0.04em;
  margin: 2.5ch 0 0.5ch; padding: 0; border: 0; color: var(--ink);
  position: static; transform: none; background: none;
}
.md h1 { border-bottom: 1px solid var(--line); padding-bottom: 0.5ch; }
.md p { margin: 0 0 1.5ch; }
.md ul, .md ol { margin: 0 0 1.5ch; padding-left: 3ch; }
.md li { margin: 0; }
.md pre {
  margin: 0 0 1.5ch; padding: 1ch 1.5ch; overflow-x: auto;
  background: var(--surface); border: 1px solid var(--line);
  line-height: 1.35;
}
.md pre code { background: none; border: 0; padding: 0; }
.md code { background: var(--surface); border: 1px solid var(--line); padding: 0 0.5ch; }
.md blockquote { margin: 0 0 1.5ch; padding-left: 2ch; border-left: 1px solid var(--line); color: var(--dim); }
.md hr { border: 0; border-top: 1px solid var(--line); margin: 2ch 0; }
.md table { margin: 0 0 1.5ch; width: 100%; max-width: 100%; table-layout: auto; }
.md th, .md td { padding: 0.3ch 2ch 0.3ch 0; border-bottom: 1px solid var(--line); white-space: normal; vertical-align: top; }
.md th { color: var(--dim); font-weight: 400; text-align: left; }
.md img { max-width: 100%; }
.md a { color: var(--cyan); border-bottom-color: var(--line); }

@media (max-width: 900px) {
  /* No room to sit side by side: the drawer takes over instead of squeezing
     the table into an unusable column. */
  :root { --drawer-w: 100vw; }
  .page.open { grid-template-columns: 0px 100vw; }
}

.empty { color: var(--dim); padding: 4ch 0; text-align: center; }
.empty strong { color: var(--ink); display: block; font-weight: 700; }
footer { color: var(--dim); margin-top: 3ch; }
kbd { color: var(--ink); border: 1px solid var(--line); padding: 0 0.5ch; }

/* ------------------------------------------------------------- responsive */
/* Container queries, not viewport queries: opening the drawer narrows the table
   without changing the viewport, so @media would never fire and the columns
   would squeeze instead of dropping.
   Thresholds are measured, not guessed: with content-sized columns the full
   eight-column table is 810px, so it needs ~870px of container once wrap and
   frame padding are counted. Re-measure these if --fs changes. */
@container main (max-width: 880px) { [data-drop="3"] { display: none; } }
@container main (max-width: 740px) { [data-drop="2"] { display: none; } }
@container main (max-width: 820px) { .controls { margin-left: 0; width: 100%; } input[type=search] { flex: 1; min-width: 0; } }
@container main (max-width: 560px) { [data-drop="1"] { display: none; } }

@media (max-width: 600px) {
  /* The whole grid derives from --fs, so stepping the type down shrinks
     everything proportionally — cheaper than dropping another column, and the
     ones left (repo, age, state, note) all earn their place. */
  :root { --fs: 13px; --lh: 20px; }
  .wrap { padding-left: 1ch; padding-right: 1ch; }
  td, th { padding-right: 1ch; }
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
  var state = { q: '', facets: {}, group: '', sort: null, dir: 1, sel: -1, selName: null };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function toneClass(t) { return t && t !== 'plain' ? 't-' + t : ''; }

  function sparkSvg(bars, big) {
    // One bar per character cell: the svg is exactly bars.length ch wide, so
    // the column lands on the same grid as every other column. viewBox units
    // are cells, so the drawing scales with the font rather than fighting it.
    var NS = 'http://www.w3.org/2000/svg';
    var max = Math.max.apply(null, bars);
    // Derived from the line-height so the chart scales with --fs/--lh instead
    // of staying pinned to whatever px looked right at one size.
    var lh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lh')) || 20;
    var n = bars.length, h = Math.round(big ? lh * 2.4 : lh * 0.7);
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'spark');
    svg.setAttribute('viewBox', '0 0 ' + n + ' ' + h);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.width = (big ? n * 2 : n) + 'ch';
    svg.style.height = h + 'px';
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', bars.reduce(function (a, b) { return a + b; }, 0) + ' commits over 8 weeks');
    for (var i = 0; i < bars.length; i++) {
      var v = bars[i];
      // Mirror the terminal's rule: any week with commits must be visibly
      // taller than an empty one. Without a floor, a 64-commit week makes a
      // 1-commit week 1px tall and 'quiet' reads as 'nothing'.
      var bh = v > 0 ? Math.max(h * 0.14, (v / max) * h) : h * 0.04;
      var r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', String(i + 0.1));
      r.setAttribute('y', String(h - bh));
      r.setAttribute('width', '0.8');
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
    var text = cell.text;
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
    tr.setAttribute('data-name', row.cells[0] ? row.cells[0].text : '');
    if (CARDS) {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', function (e) {
        if (e.target.closest('a')) return; // let a real link win
        selectRow(tr);
        openCard(tr.getAttribute('data-name'));
      });
    }
    return tr;
  }

  function renderSection(section) {
    var sec = el('section', section.clean ? 'clean' : null);
    var frame = el('div', 'frame');
    sec.appendChild(frame);

    if (section.title) {
      var h = el('h2', section.clean ? null : 'legend');
      var split = section.title.split(' \u2014 ');
      h.appendChild(document.createTextNode(split[0]));
      if (split.length > 1) {
        h.appendChild(el('span', 'desc', ' \u2014 ' + split.slice(1).join(' \u2014 ')));
      }
      frame.appendChild(h);
      if (section.clean) frame.appendChild(el('span', 'tick', '\u2713 nothing'));
    }
    if (section.note) frame.appendChild(el('p', 'note', section.note));

    var kind = section.kind || (section.columns ? 'table' : 'lines');
    var shown = section.rows.length;

    if (section.clean) { return { node: sec, shown: 0 }; }

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
      frame.appendChild(dl);
    } else if (kind === 'timeline') {
      var ul = el('ul', 'timeline');
      section.rows.forEach(function (r) {
        var li = el('li');
        li.appendChild(el('span', 'when', r.cells[0].text));
        li.appendChild(el('span', null, r.cells[1].text));
        ul.appendChild(li);
      });
      frame.appendChild(ul);
    } else if (kind === 'markdown') {
      var md = el('div', 'md');
      // Server-rendered from fully escaped input; see markdown.ts.
      md.innerHTML = section.html || '';
      frame.appendChild(md);
    } else if (kind === 'lines') {
      section.rows.forEach(function (r) {
        frame.appendChild(el('p', 'line ' + toneClass(r.cells[0].tone), r.cells.map(function (c) { return c.text; }).join(' ')));
      });
    } else {
      shown = renderTable(section, frame);
    }
    return { node: sec, shown: shown };
  }

  function render() {
    root.textContent = '';
    var total = 0;
    view.sections.forEach(function (s) {
      var out = renderSection(s);
      total += out.shown;
      root.appendChild(out.node);
    });

    // Only a filter miss earns the empty state. An audit where every check came
    // back clean also renders zero rows, and telling the user to clear a filter
    // they never set would be nonsense.
    var filtering = !!state.q || Object.keys(state.facets).length > 0;
    if (total === 0 && filtering) {
      var e = el('div', 'empty');
      e.appendChild(el('strong', null, 'Nothing matches'));
      e.appendChild(document.createTextNode('Clear the filter or a chip to see all ' + countAll() + ' rows.'));
      root.appendChild(e);
    } else if (total === 0 && countAll() === 0) {
      var e2 = el('div', 'empty');
      e2.appendChild(el('strong', null, 'Nothing to show'));
      e2.appendChild(document.createTextNode('No repos were found on GitHub or on this machine.'));
      root.appendChild(e2);
    }
    // Restore the selection by name: filtering, sorting or a refresh rebuilds
    // every row, and losing the selection would silently break o and enter.
    var rows = visibleRows();
    var i = state.selName ? rows.findIndex(function (r) { return r.getAttribute('data-name') === state.selName; }) : -1;
    if (i >= 0) applySel(rows, i, false); else { state.sel = -1; }
    updateMeta();
    measureHeader();
  }

  function countAll() {
    return view.sections.reduce(function (a, s) { return a + s.rows.length; }, 0);
  }

  var flashTimer = null;
  /** Transient one-liner in the warning slot. A key that legitimately cannot
      act must say so; silence reads as a broken keybind. */
  function flash(msg) {
    var w = document.getElementById('warning');
    if (!w) return;
    w.textContent = msg;
    w.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      if (view.warning) { w.textContent = '! ' + view.warning; w.hidden = false; }
      else { w.textContent = ''; w.hidden = true; }
    }, 2600);
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

  function applySel(rows, index, scroll) {
    rows.forEach(function (r) { r.removeAttribute('aria-selected'); });
    state.sel = index;
    var r = rows[index];
    if (!r) { state.selName = null; return null; }
    state.selName = r.getAttribute('data-name');
    r.setAttribute('aria-selected', 'true');
    if (scroll) r.scrollIntoView({ block: 'nearest' });
    return r;
  }

  function selectRow(tr) {
    var rows = visibleRows();
    var i = rows.indexOf(tr);
    if (i >= 0) applySel(rows, i, false);
  }

  function moveSel(delta) {
    var rows = visibleRows();
    if (!rows.length) return;
    // From no selection, j starts at the top rather than doing nothing.
    var next = state.sel < 0 ? (delta > 0 ? 0 : rows.length - 1)
                             : Math.max(0, Math.min(rows.length - 1, state.sel + delta));
    applySel(rows, next, true);
  }

  // ------------------------------------------------------------ card drawer
  var drawer = document.getElementById('drawer');
  var drawerBody = document.getElementById('drawer-body');
  var CARDS = document.body.getAttribute('data-cards') === '1';
  var cardToken = 0;
  var openName = null;

  var page = document.getElementById('page');

  function closeCard() {
    openName = null;
    page.classList.remove('open');
    drawer.hidden = true;
  }

  function openCard(name) {
    if (!CARDS || !name) return;
    var wasOpen = !drawer.hidden;
    openName = name;
    drawer.hidden = false;
    // Reveal on the next frame so the browser has a chance to paint the closed
    // state first; setting hidden=false and the class in the same frame skips
    // the transition entirely.
    if (!wasOpen) requestAnimationFrame(function () { page.classList.add('open'); });
    else page.classList.add('open');
    drawerBody.textContent = '';
    drawerBody.appendChild(el('p', 'loading', 'loading ' + name + '\u2026'));

    var token = ++cardToken;
    fetch('/api/repo?name=' + encodeURIComponent(name), { headers: { accept: 'application/json' } })
      .then(function (r) { return r.json().then(function (b) { if (!r.ok) throw new Error(b.error || ('HTTP ' + r.status)); return b; }); })
      .then(function (detail) {
        // A slower earlier request must never overwrite a newer card.
        if (token !== cardToken) return;
        drawerBody.textContent = '';
        detail.sections.forEach(function (sec) {
          drawerBody.appendChild(renderSection(sec).node);
        });
        drawer.scrollTop = 0;
      })
      .catch(function (err) {
        if (token !== cardToken) return;
        drawerBody.textContent = '';
        drawerBody.appendChild(el('p', 'loading t-warn', 'could not load ' + name + ': ' + err.message));
      });
  }

  document.getElementById('drawer-close').addEventListener('click', closeCard);

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
      var box = chip.querySelector('.box');
      if (box) box.textContent = on ? '[ ]' : '[x]';
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
          refresh.textContent = '[ refresh ]';
          progress.className = 'progress';
        });
    });
  }

  function selectedRow() { return visibleRows()[state.sel]; }

  document.addEventListener('keydown', function (e) {
    var typing = document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); filter.focus(); filter.select(); return; }
    if (e.key === 'Escape') {
      if (!drawer.hidden) { closeCard(); return; }
      if (typing) { filter.value = ''; state.q = ''; filter.blur(); render(); }
      return;
    }
    if (typing) return;
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault(); moveSel(1);
      // the card follows the selection, so j/k walks the list reading each one
      if (!drawer.hidden) { var r1 = selectedRow(); if (r1) openCard(r1.getAttribute('data-name')); }
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault(); moveSel(-1);
      if (!drawer.hidden) { var r2 = selectedRow(); if (r2) openCard(r2.getAttribute('data-name')); }
    } else if (e.key === 'Enter') {
      var r = selectedRow();
      if (!r) return;
      if (CARDS) openCard(r.getAttribute('data-name'));
      else if (r.getAttribute('data-href')) window.open(r.getAttribute('data-href'), '_blank', 'noreferrer');
    } else if (e.key === 'o') {
      // Prefer the repo whose card is open; fall back to the selected row.
      var name = openName || state.selName;
      var target = name
        ? root.querySelector('tbody tr[data-name="' + (window.CSS && CSS.escape ? CSS.escape(name) : name) + '"]')
        : selectedRow();
      if (!target) { flash('nothing selected \u2014 press j or click a row first'); return; }
      var href = target.getAttribute('data-href');
      if (href) window.open(href, '_blank', 'noreferrer');
      else flash(target.getAttribute('data-name') + ' is not on GitHub \u2014 nothing to open');
    }
  });

  // The column headers stick beneath the page header, so the offset has to track
  // the header's real height. It changes without a window resize: opening the
  // drawer narrows the header and re-wraps its controls. Observe the element
  // itself rather than guessing at the events that might have changed it.
  var headerEl = document.querySelector('header');
  function measureHeader() {
    if (headerEl) document.documentElement.style.setProperty('--head-h', headerEl.offsetHeight + 'px');
  }
  if (headerEl && window.ResizeObserver) {
    new ResizeObserver(measureHeader).observe(headerEl);
  } else {
    window.addEventListener('resize', measureHeader);
  }

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
        `<span class="box" aria-hidden="true">[ ]</span> ${esc(f.label)} <span class="n">${f.count}</span></button>`,
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
    ? `<button class="btn" id="refresh" type="button" data-url="${esc(opts.dataUrl ?? "/api/data?refresh=1")}">[ refresh ]</button>`
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
<body data-cards="${opts.refreshable ? "1" : "0"}">
<div class="page" id="page">
  <div class="main">
    <div class="wrap">
      <header>
        <div class="frame">
          <h1 class="legend">${esc(view.title)}</h1>
          <div class="bar">
            <span class="meta" id="meta">${esc(view.meta)}</span>
            <span class="controls">
              <input type="search" id="filter" placeholder="filter…  (press /)" autocomplete="off" spellcheck="false" aria-label="Filter rows">
              ${groupHtml(view)}
              ${refresh}
            </span>
            <div class="warning" id="warning"${view.warning ? "" : " hidden"}>${view.warning ? "! " + esc(view.warning) : ""}</div>
          </div>
          <div class="progress" id="progress"></div>
        </div>
      </header>
      ${facetsHtml(view)}
      <main id="views"></main>
      <footer>
        <kbd>/</kbd> filter · <kbd>j</kbd><kbd>k</kbd> move · <kbd>enter</kbd> card · <kbd>o</kbd> github · <kbd>esc</kbd> close · click a column to sort
      </footer>
    </div>
  </div>
  <aside class="drawer" id="drawer" hidden aria-label="Repo detail">
    <div class="frame">
      <button class="btn drawer-close" id="drawer-close" type="button" aria-label="Close">[ esc ]</button>
      <div id="drawer-body"></div>
    </div>
  </aside>
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
  opts: { open?: boolean; repo?: (name: string) => Promise<View> } = {},
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
        if (url.pathname === "/api/repo") {
          const name = url.searchParams.get("name");
          if (!name) return Response.json({ error: "name is required" }, { status: 400 });
          if (!opts.repo) return Response.json({ error: "cards are not available" }, { status: 404 });
          return Response.json(await opts.repo(name));
        }
        if (url.pathname === "/") {
          return new Response(renderHtml(await build(force), { refreshable: true }), {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        return new Response("not found", { status: 404 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (url.pathname.startsWith("/api/")) {
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
