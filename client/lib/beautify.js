// Shared text/preview helpers: escaping, text detection, and lightweight
// beautifiers (markdown, JSON, CSV, code). Used by the file manager and the
// public share-link modal so both render text the same way.

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Drive sometimes reports text files as application/octet-stream, so fall
// back to the extension.
const TEXT_EXT = /\.(txt|text|md|markdown|json|jsonc|ya?ml|csv|tsv|log|ini|conf|cfg|env|xml|html?|css|scss|less|js|mjs|cjs|jsx|ts|tsx|py|rb|php|go|rs|java|kt|swift|c|h|cpp|hpp|cs|sh|bash|zsh|fish|ps1|bat|sql|toml|properties|gradle|dockerfile|makefile|gitignore|lock)$/i;

export function isTextType(mimeType, name = '') {
  if (mimeType?.startsWith('text/')) return true;
  if (['application/json', 'application/javascript', 'application/xml', 'application/x-yaml',
       'application/yaml', 'application/x-sh', 'application/sql', 'application/x-httpd-php'].includes(mimeType)) return true;
  return TEXT_EXT.test(name);
}

export function isPreviewable(mimeType, name = '') {
  if (!mimeType) return false;
  if (mimeType.startsWith('image/')) return true;
  if (mimeType.startsWith('video/')) return true;
  if (isTextType(mimeType, name)) return true;
  if (mimeType === 'application/pdf') return true;
  return false;
}

const MD_EXT = /\.(md|markdown|mdx)$/i;
const JSON_EXT = /\.(json|jsonc|json5|webmanifest|geojson)$/i;
const CSV_EXT = /\.(csv|tsv)$/i;
const CODE_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|css|scss|less|html?|xml|svg|ya?ml|toml|ini|conf|cfg|env|properties|sh|bash|zsh|fish|py|rb|php|go|rs|java|kt|swift|c|h|cpp|hpp|cs|sql|gradle|dockerfile|makefile)$/i;

// Which text files get a beautified view instead of raw text.
export function beautyKind(mimeType = '', name = '') {
  if (MD_EXT.test(name) || mimeType === 'text/markdown') return 'markdown';
  if (JSON_EXT.test(name) || mimeType === 'application/json') return 'json';
  if (CSV_EXT.test(name) || mimeType === 'text/csv' || mimeType === 'text/tab-separated-values') return 'csv';
  if (CODE_EXT.test(name)) return 'code';
  if (/^(application|text)\/(x-)?(javascript|ecmascript|xml|x-sh|x-yaml|yaml|sql|toml)/.test(mimeType)) return 'code';
  return null;
}

const KEYWORDS = new Set(
  ('const let var function return if else for while do class new import export from await async try catch finally ' +
    'throw typeof instanceof of in null undefined true false this super extends switch case break continue default ' +
    'delete void yield static def elif then fi end print echo local fn func pub use match loop select struct impl ' +
    'package interface type enum public private protected').split(' ')
);

// One-pass tokenizer: comments, strings, numbers, keywords, yaml/ini keys.
const TOKEN_RE = /(?<com>\/\/[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|^[ \t]*#[^\n]*)|(?<str>"(?:[^"\\\n]|\\\\.)*"|'(?:[^'\\\n]|\\\\.)*'|`(?:[^`\\]|\\\\.)*`)|(?<key>^[ \t-]*[\w.$-]+(?=\s*[:=]))|(?<num>\b\d+(?:\.\d+)?\b)|(?<word>\b[A-Za-z_$][\w$]*\b)/gm;

export function highlightCode(src) {
  let last = 0;
  let html = '';
  for (const m of src.matchAll(TOKEN_RE)) {
    html += escapeHtml(src.slice(last, m.index));
    const g = m.groups;
    const cls = g.com ? 'tok-com' : g.str ? 'tok-str' : g.key ? 'tok-key' : g.num ? 'tok-num' : KEYWORDS.has(g.word) ? 'tok-kw' : null;
    html += cls ? `<span class="${cls}">${escapeHtml(m[0])}</span>` : escapeHtml(m[0]);
    last = m.index + m[0].length;
  }
  return html + escapeHtml(src.slice(last));
}

export function renderCsv(src, delimiter) {
  const splitRow = (row) => {
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (quoted) {
        if (ch === '"' && row[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delimiter) { cells.push(cell); cell = ''; }
      else cell += ch;
    }
    cells.push(cell);
    return cells;
  };

  const rows = src.split(/\r?\n/).filter((r) => r.trim()).map(splitRow);
  if (!rows.length) return '';
  const head = rows[0];
  const body = rows.slice(1);
  return `<div class="overflow-auto"><table class="w-full text-sm border-collapse">
    <thead><tr>${head.map((h) => `<th class="text-left px-3 py-2 border-b border-gray-200 dark:border-gray-700 font-semibold whitespace-nowrap">${escapeHtml(h)}</th>`).join('')}</tr></thead>
    <tbody>${body.map((r) => `<tr>${r.map((c) => `<td class="px-3 py-1.5 border-b border-gray-100 dark:border-gray-800 align-top">${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

export function prettyJson(src) {
  try {
    return JSON.stringify(JSON.parse(src), null, 2);
  } catch {
    return src;
  }
}

const JSON_TOKEN_RE = /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b(?:true|false|null)\b/g;

// Pretty-print JSON, then color keys, strings, numbers and literals.
export function highlightJson(src) {
  const pretty = prettyJson(src);
  let last = 0;
  let html = '';
  for (const m of pretty.matchAll(JSON_TOKEN_RE)) {
    html += escapeHtml(pretty.slice(last, m.index));
    const t = m[0];
    const cls = t.startsWith('"')
      ? (/^\s*:/.test(pretty.slice(m.index + t.length)) ? 'tok-key' : 'tok-str')
      : /^(true|false|null)$/.test(t) ? 'tok-kw' : 'tok-num';
    html += `<span class="${cls}">${escapeHtml(t)}</span>`;
    last = m.index + t.length;
  }
  return html + escapeHtml(pretty.slice(last));
}

// Tiny markdown renderer: escapes everything first, so file content can never
// inject HTML. Enough for headings, lists, code, quotes, links, emphasis.
export function renderMarkdown(src) {
  const safeUrl = (u) => /^(https?:|mailto:|#|\/|\.)/i.test(u);
  const inline = (s) => escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => (safeUrl(url) ? `<img src="${url}" alt="${alt}" loading="lazy">` : m))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, url) => (safeUrl(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${txt}</a>` : m))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');

  const out = [];
  let para = [];
  let list = null;
  let fence = null;

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const flushAll = () => { flushPara(); flushList(); };

  for (const line of src.split('\n')) {
    if (line.startsWith('```')) {
      if (fence) { out.push(`<pre><code>${escapeHtml(fence.join('\n'))}</code></pre>`); fence = null; }
      else { flushAll(); fence = []; }
      continue;
    }
    if (fence) { fence.push(line); continue; }
    if (!line.trim()) { flushAll(); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    if (/^(-{3,}|\*\*\*|___)\s*$/.test(line)) { flushAll(); out.push('<hr>'); continue; }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) { flushAll(); out.push(`<blockquote>${inline(quote[1])}</blockquote>`); continue; }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const tag = ul ? 'ul' : 'ol';
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push((ul || ol)[1]);
      continue;
    }

    flushList();
    para.push(line.trim());
  }
  if (fence) out.push(`<pre><code>${escapeHtml(fence.join('\n'))}</code></pre>`);
  flushAll();
  return out.join('\n');
}