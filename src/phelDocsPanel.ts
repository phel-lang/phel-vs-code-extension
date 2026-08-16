// Pure renderer for the docs panel: the searchable webview behind
// `Phel: Show Documentation`.
//
// Everything the panel needs is inlined into one document - no CDN, no local
// resource roots, nothing shipped beside the corpus we already bundle - so the
// policy can be `default-src 'none'` with a per-render nonce on the one
// stylesheet and the one script. The corpus travels with the page as a JSON
// payload the script filters client-side: ~900 public symbols are far cheaper
// to keep in the webview than to round-trip through `postMessage` on every
// keystroke, and the detail of the one symbol you land on is the only thing
// worth asking the extension for.
//
// Docstrings are user-authored text from `.phel` sources, so nothing here ever
// interpolates one into HTML unescaped. The list is built from the payload with
// `textContent`; the detail pane goes through `markdownLiteToHtml`, which
// understands the four things `renderDocMarkdown` emits - fenced code, inline
// code, links, emphasis - and escapes everything else.

import type { PhelDoc } from './phelDocs';
import { renderDocMarkdown } from './phelDocsLookup';
import { buildQuickPickEntries } from './phelShowDoc';

/** One row of the panel's client-side search index. */
export interface DocsPanelEntry {
    qualifiedName: string;
    name: string;
    ns: string;
    /** The `(name & args)` line, or `''` for a `def`. */
    signature: string;
    /** First line of the docstring, or `''` when there is none. */
    docFirstLine: string;
}

export interface DocsPanelState {
    /** Prefilled search box; the script filters `results` with it on load. */
    query: string;
    /** The whole searchable payload. */
    results: readonly DocsPanelEntry[];
    /** The symbol whose detail pane is rendered into the initial HTML. */
    selected?: PhelDoc;
}

/**
 * The panel's search index, in the order the quick pick uses (public symbols
 * only, `phel.core` first, alphabetical within a namespace) - the panel is the
 * same list with a bigger window onto it.
 */
export function buildDocsPayload(docs: readonly PhelDoc[]): DocsPanelEntry[] {
    return buildQuickPickEntries(docs).map(({ doc }) => ({
        qualifiedName: doc.qualifiedName,
        name: doc.name,
        ns: doc.ns,
        signature: doc.signature ?? '',
        docFirstLine: firstLine(doc.doc),
    }));
}

/** The detail pane for one symbol: the hover's Markdown, as safe HTML. */
export function renderDetailHtml(doc: PhelDoc): string {
    const html = markdownLiteToHtml(renderDocMarkdown(doc));
    const reference = referenceUrl(doc.ns);
    if (!reference) {
        return html;
    }
    return `${html}\n<p class="detail__links"><a href="${escapeHtml(reference)}">${escapeHtml(doc.ns)} on phel-lang.org</a></p>`;
}

/**
 * Where phel-lang.org documents `ns`, or `undefined` for a namespace it does
 * not publish (anything outside the shipped `phel.*` ones).
 *
 * The page is linked without an anchor on purpose. The site's per-symbol
 * anchors are slugified headings de-duplicated in document order, so `map?` is
 * `#map-1` and `assert` is `#assert-1` (`*assert*` took `#assert` first);
 * nothing in the corpus can derive that, and a wrong anchor is worse than
 * landing at the top of the right page.
 */
export function referenceUrl(ns: string): string | undefined {
    if (ns !== 'phel' && !ns.startsWith('phel.')) {
        return undefined;
    }
    const slug = ns.replace(/^phel\.?/, '').replace(/\./g, '-');
    return slug ? `https://phel-lang.org/documentation/reference/api/${slug}/` : undefined;
}

/** The whole panel document. `nonce` must be fresh per render. */
export function renderDocsPanelHtml(state: DocsPanelState, nonce: string): string {
    const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;
    const detail = state.selected
        ? renderDetailHtml(state.selected)
        : '<p class="detail__empty">Pick a symbol to read its documentation.</p>';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Phel API</title>
<style nonce="${nonce}">${PANEL_CSS}</style>
</head>
<body>
<header class="search">
<input id="query" type="search" spellcheck="false" autocomplete="off" autofocus
    placeholder="Search ${state.results.length} Phel symbols" value="${escapeHtml(state.query)}">
</header>
<main class="layout">
<ul id="results" class="results" tabindex="-1"></ul>
<article id="detail" class="detail" data-selected="${escapeHtml(state.selected?.qualifiedName ?? '')}">${detail}</article>
</main>
<script id="payload" type="application/json" nonce="${nonce}">${embedJson(state.results)}</script>
<script nonce="${nonce}">${PANEL_JS}</script>
</body>
</html>`;
}

/**
 * Markdown as far as `renderDocMarkdown` writes it, and no further: fenced
 * code, inline code, `http(s)` links, `**bold**` and `_emphasis_`. Everything
 * else - including every character of a docstring - is escaped, so a `.phel`
 * file can never put markup, let alone a script, into the panel.
 */
export function markdownLiteToHtml(markdown: string): string {
    const chunks: string[] = [];
    let last = 0;
    for (const fence of markdown.matchAll(FENCE_RE)) {
        const at = fence.index ?? 0;
        chunks.push(renderProse(markdown.slice(last, at)));
        chunks.push(
            `<pre><code class="lang-${fence[1]}">${escapeHtml(fence[2].replace(/\n+$/, ''))}</code></pre>`
        );
        last = at + fence[0].length;
    }
    chunks.push(renderProse(markdown.slice(last)));
    return chunks.filter((chunk) => chunk.length > 0).join('\n');
}

/** ```lang\n…\n``` - the only block construct the docs corpus uses. */
const FENCE_RE = /```([A-Za-z0-9_-]*)\n([\s\S]*?)```/g;
const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
/**
 * Where a code span was lifted out, so emphasis and links cannot reach inside
 * one. A private-use codepoint delimits it: no docstring holds one, and unlike
 * NUL it is a character a regular expression may name without a lint waiver.
 */
const SPAN_RE = /\uE000(\d+)\uE000/g;

function renderProse(markdown: string): string {
    return markdown
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph.length > 0)
        .map((paragraph) => `<p>${renderInline(paragraph)}</p>`)
        .join('\n');
}

function renderInline(text: string): string {
    const spans: string[] = [];
    const lifted = escapeHtml(text).replace(/`([^`]+)`/g, (_all, code: string) => {
        spans.push(code);
        return `\uE000${spans.length - 1}\uE000`;
    });
    return lifted
        .replace(LINK_RE, (_all, label: string, url: string) => `<a href="${url}">${label}</a>`)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/_([^_\n]+)_/g, '<em>$1</em>')
        .replace(/\n/g, '<br>')
        .replace(SPAN_RE, (_all, index: string) => `<code>${spans[Number(index)]}</code>`);
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** JSON for a `<script type="application/json">` block: `<` can never open a tag. */
function embedJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

function firstLine(text?: string): string {
    return text ? text.split(/\r?\n/, 1)[0].trim() : '';
}

const PANEL_CSS = `
* { box-sizing: border-box; }
body {
    margin: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
}
.search { padding: 12px 16px 8px; }
#query {
    width: 100%;
    padding: 6px 8px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    font-size: inherit;
}
#query:focus { outline: 1px solid var(--vscode-focusBorder); }
.layout { display: flex; gap: 16px; padding: 0 16px 16px; align-items: flex-start; }
.results {
    flex: 0 0 300px;
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    margin: 0;
    padding: 0;
    list-style: none;
}
.row { padding: 4px 8px; border-radius: 3px; cursor: pointer; }
.row:hover { background: var(--vscode-list-hoverBackground); }
.row.is-active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.row__name { font-weight: 600; }
.row__ns { opacity: 0.7; margin-left: 6px; font-size: 0.9em; }
.row__doc { display: block; opacity: 0.8; font-size: 0.9em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.more, .empty { padding: 6px 8px; opacity: 0.7; font-style: italic; }
.detail { flex: 1 1 auto; min-width: 0; max-height: calc(100vh - 80px); overflow-y: auto; }
.detail p { margin: 0 0 8px; }
.detail a { color: var(--vscode-textLink-foreground); }
.detail code { font-family: var(--vscode-editor-font-family); font-size: 0.95em; }
.detail pre {
    padding: 8px 10px;
    overflow-x: auto;
    background: var(--vscode-textCodeBlock-background);
    border-radius: 3px;
}
.detail__empty { opacity: 0.7; }
`;

const PANEL_JS = `
const api = acquireVsCodeApi();
const data = JSON.parse(document.getElementById('payload').textContent);
const query = document.getElementById('query');
const results = document.getElementById('results');
const detail = document.getElementById('detail');
const MAX_ROWS = 200;
let shown = [];
let active = -1;

function render() {
    const needle = query.value.trim().toLowerCase();
    const found = needle
        ? data.filter((e) =>
              e.qualifiedName.toLowerCase().includes(needle) ||
              e.docFirstLine.toLowerCase().includes(needle))
        : data;
    shown = found.slice(0, MAX_ROWS);
    results.textContent = '';
    shown.forEach((entry, index) => {
        const row = document.createElement('li');
        row.className = 'row';
        const name = document.createElement('span');
        name.className = 'row__name';
        name.textContent = entry.name;
        const ns = document.createElement('span');
        ns.className = 'row__ns';
        ns.textContent = entry.ns;
        const doc = document.createElement('span');
        doc.className = 'row__doc';
        doc.textContent = entry.signature || entry.docFirstLine;
        row.append(name, ns, doc);
        row.addEventListener('click', () => select(index));
        results.append(row);
    });
    const hidden = found.length - shown.length;
    if (hidden > 0) {
        const more = document.createElement('li');
        more.className = 'more';
        more.textContent = '+' + hidden + ' more; refine the search';
        results.append(more);
    }
    if (found.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'empty';
        empty.textContent = 'No symbol matches.';
        results.append(empty);
    }
    active = shown.findIndex((e) => e.qualifiedName === detail.dataset.selected);
    mark();
}

function mark() {
    Array.prototype.forEach.call(results.children, (row, index) => {
        row.classList.toggle('is-active', index === active);
    });
    if (active >= 0) {
        results.children[active].scrollIntoView({ block: 'nearest' });
    }
}

function select(index) {
    const entry = shown[index];
    if (!entry) {
        return;
    }
    active = index;
    detail.dataset.selected = entry.qualifiedName;
    mark();
    api.postMessage({ type: 'select', qualifiedName: entry.qualifiedName });
}

function move(delta) {
    if (shown.length === 0) {
        return;
    }
    const next = active < 0 ? 0 : Math.min(Math.max(active + delta, 0), shown.length - 1);
    select(next);
}

query.addEventListener('input', render);
query.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
        move(1);
    } else if (event.key === 'ArrowUp') {
        move(-1);
    } else if (event.key === 'Enter') {
        move(active < 0 ? 1 : 0);
    } else {
        return;
    }
    event.preventDefault();
});
window.addEventListener('message', (event) => {
    const message = event.data;
    if (message && message.type === 'detail' && message.qualifiedName === detail.dataset.selected) {
        detail.innerHTML = message.html;
    }
});
render();
`;
