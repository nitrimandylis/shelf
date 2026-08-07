// A deliberately small markdown renderer for README bodies.
//
// It runs on the server, not in the page, for two reasons: it can be unit
// tested, and the client never has to parse untrusted text. Everything is
// escaped BEFORE any formatting is applied, and only a fixed set of tags is
// ever emitted, so a README cannot inject markup no matter what it contains.
//
// Raw HTML in the source is stripped rather than escaped-and-shown: READMEs
// here open with `<div align="center">` wrappers and `<img>` badges, and
// rendering those as literal tag soup reads worse than dropping them.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// NUL is the placeholder delimiter: it cannot occur in a README, so a fence or
// an inline-code marker can never be forged by the document itself.
const SENTINEL = "\u0000";
const FENCE_RE = /^\u0000FENCE(\d+)\u0000$/;
const CODE_RE = /\u0000CODE(\d+)\u0000/g;

/** Only absolute http(s)/mailto links survive; everything else renders as text. */
export function safeUrl(raw: string): string | null {
  const u = raw.trim();
  if (!u) return null;
  if (/^(https?:\/\/|mailto:)/i.test(u)) return u;
  return null;
}

/** Drop HTML tags, keeping image alt text as a bracketed label. */
function stripHtml(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<img\b[^>]*\balt=["']([^"']*)["'][^>]*>/gi, (_m, alt: string) => (alt ? `[${alt}]` : ""))
    .replace(/<img\b[^>]*>/gi, "")
    // Requires a letter after `<`, so prose like "a < b && c > d" is left alone.
    .replace(/<\/?[a-zA-Z][^>]*>/g, "");
}

/** Inline formatting. Input must already be HTML-escaped. */
function inline(escaped: string): string {
  let out = escaped;

  // `code` first so its contents are not re-formatted
  const codes: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_m, body: string) => {
    codes.push(body);
    return `${SENTINEL}CODE${codes.length - 1}${SENTINEL}`;
  });

  // ![alt](url) -> [alt]; images are never loaded, the page makes no requests
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt: string) => (alt ? `[${alt}]` : ""));

  // [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, text: string, href: string) => {
    const url = safeUrl(href);
    return url
      ? `<a href="${url}" target="_blank" rel="noreferrer noopener">${text}</a>`
      : text;
  });

  // bare urls
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_m, pre: string, url: string) =>
    `${pre}<a href="${url}" target="_blank" rel="noreferrer noopener">${url}</a>`);

  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  return out.replace(CODE_RE, (_m, i: string) => `<code>${codes[Number(i)]}</code>`);
}

function renderTable(rows: string[]): string {
  const cells = (line: string) =>
    line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const head = cells(rows[0]!);
  const body = rows.slice(2).map(cells); // row 1 is the --- separator
  const th = head.map((c) => `<th>${inline(c)}</th>`).join("");
  const tr = body
    .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

/** Markdown -> HTML. The output is safe by construction. */
export function renderMarkdown(src: string): string {
  if (!src.trim()) return "";

  // Fenced code is extracted first and only escaped, never formatted, so ASCII
  // art banners survive exactly as written.
  const fences: string[] = [];
  const withoutFences = src.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, body: string) => {
    fences.push(body.replace(/\n$/, ""));
    return `\n${SENTINEL}FENCE${fences.length - 1}${SENTINEL}\n`;
  });

  const lines = escapeHtml(stripHtml(withoutFences)).split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.type}>`);
      list = null;
    }
  };
  const flushAll = () => {
    flushPara();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = line.match(FENCE_RE);

    if (fence) {
      flushAll();
      out.push(`<pre><code>${escapeHtml(fences[Number(fence[1])]!)}</code></pre>`);
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = Math.min(6, heading[1]!.length);
      out.push(`<h${level}>${inline(heading[2]!.replace(/\s+#+\s*$/, ""))}</h${level}>`);
      continue;
    }

    if (/^(?:[-*_]\s*){3,}$/.test(line.trim())) {
      flushAll();
      out.push("<hr>");
      continue;
    }

    // table: a header row followed by a |---|---| separator
    if (line.trim().startsWith("|") && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] ?? "")) {
      flushAll();
      const block: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) block.push(lines[i++]!);
      i--;
      out.push(renderTable(block));
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushPara();
      const type = bullet ? "ul" : "ol";
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }

    const quote = line.match(/^&gt;\s?(.*)$/);
    if (quote) {
      flushAll();
      out.push(`<blockquote>${inline(quote[1]!)}</blockquote>`);
      continue;
    }

    flushList();
    para.push(line.trim());
  }

  flushAll();
  return out.join("\n");
}
