// Flags what Phel 0.50 removed or deprecated, so the editor can say what to
// write instead.
//
// Four families, each earning its keep for a different reason:
//
//   * The removed core aliases are a hard failure on 0.50, and the compiler
//     reports them as an unresolvable symbol. It cannot know that `push` used
//     to mean `conj`, so the useful half of the message only exists here.
//   * The removed reader syntax (`#| |#`, a bare `#` comment, `|()` short
//     functions, `foo$` gensyms) stops lexing, which the compiler does report,
//     but as a lexer error at the wrong spot. And `,` inside a syntax-quote is
//     the dangerous one: it became whitespace, so `` `(f ,x) `` still parses and
//     quietly quotes `x`. No error anywhere; only a wrong expansion.
//   * The deprecated forms still compile, and the compiler only mentions them
//     under `--warn-deprecations`. A `.phel` buffer would otherwise say nothing
//     about a spelling the language has moved off.
//   * A definition carrying `:deprecated` metadata warns at every call site
//     under the same flag. The workspace index knows those definitions, so the
//     buffer can carry the same note.
//
// Sources: phel-lang `docs/migration/removed-deprecated-core-fns.md`,
// `docs/migration/deprecated-surface.md`, `docs/migration/backslash-to-dot.md`
// and the deprecated table in `docs/spec/language-surface.md`.
//
// Pure — no `vscode` import, so the detection is unit-testable and can be run
// over a corpus by `scripts/sweep-analyzers.mjs`.

import { parseAll, readForm, type Form } from './phelParedit';
import { collectAllBindings } from './phelScope';
import { parsePhelFile } from './phelDocs';

export type MigrationStatus = 'removed' | 'deprecated';

export interface MigrationEntry {
    /** The spelling to look for in call position. */
    name: string;
    status: MigrationStatus;
    /** Phel version the change landed in. */
    since: string;
    /**
     * A head symbol that can replace this one with no other edit. Set only
     * where the swap is exactly equivalent, because it is what the quick fix
     * writes; a replacement that needs the arguments rearranged is described
     * in `detail` instead.
     */
    replacement?: string;
    /** What to write instead, as a sentence fragment. */
    detail: string;
}

/**
 * The 0.50 migration table for names in call position. `removed` entries are
 * the long-deprecated `phel.core` aliases dropped in 0.50; `deprecated`
 * entries are the four forms the language-surface spec froze but superseded.
 */
export const MIGRATIONS: readonly MigrationEntry[] = [
    // Removed core aliases (#2784). Each was a thin alias, so the replacement
    // takes the same arguments — hence a head swap is a complete fix.
    { name: 'push', status: 'removed', since: '0.50', replacement: 'conj', detail: 'use `conj`' },
    { name: 'put', status: 'removed', since: '0.50', replacement: 'assoc', detail: 'use `assoc`' },
    {
        name: 'unset',
        status: 'removed',
        since: '0.50',
        replacement: 'dissoc',
        detail: 'use `dissoc`',
    },
    {
        name: 'put-in',
        status: 'removed',
        since: '0.50',
        replacement: 'assoc-in',
        detail: 'use `assoc-in`',
    },
    {
        name: 'unset-in',
        status: 'removed',
        since: '0.50',
        replacement: 'dissoc-in',
        detail: 'use `dissoc-in`',
    },
    { name: 'values', status: 'removed', since: '0.50', replacement: 'vals', detail: 'use `vals`' },
    {
        name: 'function?',
        status: 'removed',
        since: '0.50',
        replacement: 'fn?',
        detail: 'use `fn?`',
    },
    {
        name: 'hash-map?',
        status: 'removed',
        since: '0.50',
        replacement: 'map?',
        detail: 'use `map?`',
    },
    {
        name: 'id',
        status: 'removed',
        since: '0.50',
        replacement: 'identical?',
        detail: 'use `identical?`',
    },
    {
        name: 'set-meta!',
        status: 'removed',
        since: '0.50',
        replacement: 'with-meta',
        detail: 'use `with-meta`',
    },
    {
        // Moved namespace, so the fix needs a `:require` as well as a rename.
        name: 'str-contains?',
        status: 'removed',
        since: '0.50',
        detail: 'use `phel.string/contains?`, which needs `(:require phel.string :as s)`',
    },
    {
        name: 'print-summary',
        status: 'removed',
        since: '0.50',
        detail: '`run-tests` already emits `:summary`; react to that event instead of triggering it',
    },

    // Deprecated as source (ADR 0007). Still the compilation target, still
    // legal for every 1.x, but no longer the spelling to write.
    {
        name: 'php/new',
        status: 'deprecated',
        since: '0.50',
        replacement: 'new',
        detail: 'write `(new Foo arg)` or `(Foo. arg)`',
    },
    {
        name: 'php/->',
        status: 'deprecated',
        since: '0.50',
        detail: 'write `(.method obj arg)` for a call and `(.-field obj)` for a value member',
    },
    {
        name: 'php/::',
        status: 'deprecated',
        since: '0.50',
        detail: 'write `(Foo/method arg)` for a call and `Foo/CONST` for a constant',
    },
    {
        name: 'set-var',
        status: 'deprecated',
        since: '0.50',
        detail: "write `(alter-var-root #'v f)` for the root, or `(set! v x)` for the current binding frame",
    },
];

/**
 * The reader-level half of the 0.50 table (#2827), keyed by the spelling.
 * Everything here except the separator stopped lexing; the separator still
 * parses and is the one reader-level item whose removal is not yet scheduled.
 */
export const SYNTAX_MIGRATIONS = {
    blockComment: {
        name: '#|',
        status: 'removed',
        since: '0.50',
        detail: 'use `;;` line comments, or `#_` to skip one form',
    },
    lineComment: {
        name: '#',
        status: 'removed',
        since: '0.50',
        detail: 'use `;`',
    },
    shortFn: {
        name: '|(',
        status: 'removed',
        since: '0.50',
        detail: 'write `#( … )` with `%` parameters',
    },
    gensym: {
        name: 'foo$',
        status: 'removed',
        since: '0.50',
        detail: 'write `foo#`',
    },
    unquote: {
        name: ',',
        status: 'removed',
        since: '0.50',
        detail: 'write `~`',
    },
    reference: {
        name: '^:reference',
        status: 'removed',
        since: '0.50',
        detail: 'write `^:by-ref`',
    },
    separator: {
        name: '\\',
        status: 'deprecated',
        since: '0.50',
        detail: 'write `.`',
    },
} as const satisfies Record<string, MigrationEntry>;

/** One textual replacement, offsets into the source the issue was found in. */
export interface MigrationEdit {
    start: number;
    end: number;
    text: string;
}

/** A complete rewrite of one issue; what the quick fix applies. */
export interface MigrationFix {
    title: string;
    edits: MigrationEdit[];
}

export interface MigrationIssue {
    /** Offset of the flagged token. */
    start: number;
    /** Offset just past the flagged token. */
    end: number;
    name: string;
    status: MigrationStatus;
    /** Set when a plain head swap fixes the call. `fix` carries the same edit. */
    replacement?: string;
    /** Ready-to-render sentence. */
    message: string;
    /** Set when the rewrite is mechanical enough to offer as a quick fix. */
    fix?: MigrationFix;
}

/**
 * A workspace definition carrying `:deprecated` metadata, as `phelDocs`
 * reads it: `deprecated` is the metadata value rendered as text (a version,
 * a reason, or `true`), `supersededBy` the optional replacement name.
 */
export interface DeprecatedDefinition {
    deprecated: string;
    supersededBy?: string;
}

export interface MigrationOptions {
    /**
     * Definitions the workspace marks `:deprecated`, keyed by bare name. A
     * call to one is reported the way the compiler reports it under
     * `--warn-deprecations`.
     */
    deprecatedDefinitions?: ReadonlyMap<string, DeprecatedDefinition>;
}

/** The message a diagnostic carries, kept here so tests can assert on it. */
export function migrationMessage(entry: MigrationEntry): string {
    const verb =
        entry.status === 'removed'
            ? `was removed in Phel ${entry.since}`
            : `is deprecated as source since Phel ${entry.since}`;
    return `\`${entry.name}\` ${verb}; ${entry.detail}.`;
}

const VERSION_RE = /^\d+(?:\.\d+){1,3}$/;

/**
 * The message for a call to a definition marked `:deprecated`, phrased the
 * way `DeprecatedDefinitionWarner` phrases it: a version string reads as
 * "since", any other string is the reason, `true` says nothing more.
 */
export function deprecatedDefinitionMessage(name: string, def: DeprecatedDefinition): string {
    const detail = VERSION_RE.test(def.deprecated)
        ? ` (since ${def.deprecated})`
        : def.deprecated && def.deprecated !== 'true'
          ? `: ${def.deprecated}`
          : '';
    const use = def.supersededBy ? ` Use \`${def.supersededBy}\` instead.` : '';
    return `\`${name}\` is deprecated${detail}.${use}`;
}

const TERMINATORS = new Set([' ', '\t', '\n', '\r', ',', '(', ')', '[', ']', '{', '}', '"', ';']);
const CLOSERS = new Set([')', ']', '}']);

function isTokenStart(src: string, i: number): boolean {
    return i === 0 || TERMINATORS.has(src[i - 1]);
}

function skipString(src: string, start: number): number {
    let i = start + 1;
    while (i < src.length) {
        const c = src[i];
        if (c === '\\') {
            i += 2;
            continue;
        }
        if (c === '"') {
            return i + 1;
        }
        i++;
    }
    return src.length;
}

function skipToLineEnd(src: string, start: number): number {
    let i = start;
    while (i < src.length && src[i] !== '\n') {
        i++;
    }
    return i;
}

/** End of a `\c` / `\name` / `\Foo\Bar` token: `\` reads to the next terminator. */
function skipBackslashToken(src: string, start: number): number {
    let i = start + 1;
    while (i < src.length && !TERMINATORS.has(src[i])) {
        i++;
    }
    return i === start + 1 && i < src.length ? i + 1 : i;
}

/** Offset just past the closing `|#`, or -1 when the comment never closes. */
function blockCommentEnd(src: string, start: number): number {
    let i = start + 2;
    while (i < src.length - 1) {
        if (src[i] === '|' && src[i + 1] === '#') {
            return i + 2;
        }
        i++;
    }
    return -1;
}

/**
 * Rewrite a `#| … |#` comment as `;;` lines. Only offered when nothing but
 * whitespace follows the closer on its line, since a `;;` swallows the rest
 * of the line and would otherwise comment out live code.
 */
function blockCommentFix(src: string, start: number, close: number): MigrationFix | undefined {
    if (close < 0) {
        return undefined;
    }
    const rest = src.slice(close, skipToLineEnd(src, close));
    if (rest.trim() !== '') {
        return undefined;
    }
    const edits: MigrationEdit[] = [{ start, end: start + 2, text: ';;' }];
    for (let i = start + 2; i < close - 2; i++) {
        if (src[i] === '\n') {
            edits.push({ start: i + 1, end: i + 1, text: ';;' });
        }
    }
    edits.push({ start: close - 2, end: close, text: '' });
    return { title: 'Rewrite as ;; comments', edits };
}

/**
 * Rewrite `|( … )` as `#( … )`, renaming the `$` parameters to `%`. Reads
 * the form so a `$` inside a string is left alone.
 */
function shortFnFix(src: string, bar: number): MigrationFix {
    const edits: MigrationEdit[] = [{ start: bar, end: bar + 2, text: '#(' }];
    const form = readForm(src, bar + 1, src.length);
    const rename = (f: Form): void => {
        if (f.kind === 'atom') {
            const text = src.slice(f.bodyStart, f.bodyEnd);
            if (/^\$(\d+|&)?$/.test(text)) {
                edits.push({ start: f.bodyStart, end: f.bodyStart + 1, text: '%' });
            }
        }
        f.children.forEach(rename);
    };
    if (form) {
        rename(form);
    }
    return { title: 'Rewrite as #( … ) with % parameters', edits };
}

/**
 * The spans of every syntax-quoted form. Only inside one of these does a `,`
 * or a trailing `$` mean anything different from what it meant before 0.50.
 */
function syntaxQuoteSpans(src: string, forms: readonly Form[]): Array<[number, number]> {
    const spans: Array<[number, number]> = [];
    const visit = (list: readonly Form[]): void => {
        for (const f of list) {
            if (src.slice(f.start, f.bodyStart).includes('`')) {
                spans.push([f.start, f.end]);
            } else {
                visit(f.children);
            }
        }
    };
    visit(forms);
    return spans;
}

/**
 * The removed reader syntax, found by a lexical pass: none of it survives the
 * structural reader as a token, so the tree cannot report it. Strings, char
 * literals and `;` comments are stepped over the way the lexer steps over them.
 */
function scanSyntax(
    src: string,
    inSyntaxQuote: (offset: number) => boolean,
    issues: MigrationIssue[]
): void {
    const len = src.length;
    let i = 0;
    while (i < len) {
        const c = src[i];
        if (c === '"') {
            i = skipString(src, i);
            continue;
        }
        if (c === '#' && src[i + 1] === '"') {
            i = skipString(src, i + 1);
            continue;
        }
        if (c === '\\') {
            i = skipBackslashToken(src, i);
            continue;
        }
        if (c === ';') {
            i = skipToLineEnd(src, i);
            continue;
        }
        if (c === '#' && src[i + 1] === '|' && isTokenStart(src, i)) {
            const close = blockCommentEnd(src, i);
            const entry = SYNTAX_MIGRATIONS.blockComment;
            issues.push({
                start: i,
                end: i + 2,
                name: entry.name,
                status: entry.status,
                message: `\`#| … |#\` block comments were removed in Phel ${entry.since}; ${entry.detail}.`,
                ...withFix(blockCommentFix(src, i, close)),
            });
            i = close < 0 ? len : close;
            continue;
        }
        if (c === '#' && isTokenStart(src, i) && (i + 1 >= len || /[ \t\r\n]/.test(src[i + 1]))) {
            const entry = SYNTAX_MIGRATIONS.lineComment;
            issues.push({
                start: i,
                end: i + 1,
                name: entry.name,
                status: entry.status,
                message: `A bare \`#\` line comment was removed in Phel ${entry.since}; ${entry.detail}.`,
                fix: {
                    title: 'Rewrite as ; comment',
                    edits: [{ start: i, end: i + 1, text: ';' }],
                },
            });
            i = skipToLineEnd(src, i);
            continue;
        }
        if (c === '|' && src[i + 1] === '(' && isTokenStart(src, i)) {
            const entry = SYNTAX_MIGRATIONS.shortFn;
            issues.push({
                start: i,
                end: i + 2,
                name: entry.name,
                status: entry.status,
                message: `\`|( … )\` short functions were removed in Phel ${entry.since}; ${entry.detail}.`,
                fix: shortFnFix(src, i),
            });
            i += 2;
            continue;
        }
        if (c === '^' && src.startsWith(':reference', i + 1) && isBoundaryAt(src, i + 11)) {
            const entry = SYNTAX_MIGRATIONS.reference;
            issues.push({
                start: i,
                end: i + 11,
                name: entry.name,
                status: entry.status,
                message: migrationMessage(entry),
                fix: {
                    title: 'Replace with ^:by-ref',
                    edits: [{ start: i + 1, end: i + 11, text: ':by-ref' }],
                },
            });
            i += 11;
            continue;
        }
        if (c === ',' && inSyntaxQuote(i)) {
            const next = src[i + 1];
            const meant = next !== undefined && !/[ \t\r\n,;]/.test(next) && !CLOSERS.has(next);
            if (meant) {
                const entry = SYNTAX_MIGRATIONS.unquote;
                const splicing = next === '@';
                const target = describeUnquoteTarget(src, splicing ? i + 2 : i + 1);
                issues.push({
                    start: i,
                    end: i + (splicing ? 2 : 1),
                    name: entry.name,
                    status: entry.status,
                    message:
                        `\`,\` is whitespace since Phel ${entry.since}, so \`${target}\` is quoted rather than ` +
                        `unquoted here; write \`${splicing ? '~@' : '~'}${target}\`.`,
                    fix: {
                        title: `Replace ',${splicing ? '@' : ''}' with '~${splicing ? '@' : ''}'`,
                        edits: [{ start: i, end: i + 1, text: '~' }],
                    },
                });
            }
            i++;
            continue;
        }
        i++;
    }
}

function isBoundaryAt(src: string, i: number): boolean {
    return i >= src.length || TERMINATORS.has(src[i]);
}

/** The token a `,` was meant to unquote, for the message; `…` for a form. */
function describeUnquoteTarget(src: string, at: number): string {
    const form = readForm(src, at, src.length);
    if (!form || form.start !== at) {
        return '…';
    }
    if (form.kind === 'atom') {
        return src.slice(form.bodyStart, form.bodyEnd);
    }
    return '…';
}

function withFix(fix: MigrationFix | undefined): { fix?: MigrationFix } {
    return fix === undefined ? {} : { fix };
}

/**
 * `phel\string`, `my-app\core/foo`, `\Phel\Lang\Symbol`: identifier segments
 * joined by `\`, optionally with a leading marker and a `/member` tail. A
 * char literal (`\newline`, `\\`) has no second segment and never matches.
 */
const BACKSLASH_NAME_RE = /^(\\?)([A-Za-z_][\w-]*(?:\\[A-Za-z_][\w-]*)+)(\/[^\s]*)?$/;

function separatorIssue(src: string, form: Form): MigrationIssue | undefined {
    const text = src.slice(form.bodyStart, form.bodyEnd);
    const m = BACKSLASH_NAME_RE.exec(text);
    if (!m) {
        return undefined;
    }
    const [, marker, ns, tail = ''] = m;
    const dotted = ns.replace(/\\/g, '.');
    const entry = SYNTAX_MIGRATIONS.separator;
    const head = `\`\\\` as a namespace separator is deprecated since Phel ${entry.since}`;
    // A lower-case-initial PHP namespace cannot be spelled dotted in place —
    // that reads as a Phel namespace — so it has to be imported first.
    if (marker && /^[a-z]/.test(ns)) {
        return {
            start: form.bodyStart,
            end: form.bodyEnd,
            name: text,
            status: entry.status,
            message: `${head}; import the class with \`(:use ${dotted})\` and refer to it by its short name.`,
        };
    }
    const replacement = `${dotted}${tail}`;
    return {
        start: form.bodyStart,
        end: form.bodyEnd,
        name: text,
        status: entry.status,
        replacement,
        message: `${head}; write \`${replacement}\`.`,
        fix: {
            title: `Replace '${text}' with '${replacement}'`,
            edits: [{ start: form.bodyStart, end: form.bodyEnd, text: replacement }],
        },
    };
}

/**
 * Find every use of something 0.50 removed or deprecated in `src`.
 *
 * For the call-position tables only the head of a list is considered. The
 * removed names are ordinary words — `values`, `id` and `put` are common
 * binding names and map keys — so a scanner that matched every occurrence
 * would fire constantly on correct code. Two further guards keep it quiet: a
 * name the file defines itself, and a name a local binding shadows at that
 * point, are both left alone.
 *
 * Quoted forms are skipped: `'(push 1 2)` is data, not a call. A syntax-quote
 * is not, since a macro template expands into a real call site.
 */
export function findMigrationIssues(src: string, options: MigrationOptions = {}): MigrationIssue[] {
    const table = new Map(MIGRATIONS.map((e) => [e.name, e]));
    const deprecatedDefs = options.deprecatedDefinitions ?? new Map<string, DeprecatedDefinition>();
    const issues: MigrationIssue[] = [];

    // Names this file introduces itself; its `push` is not phel.core's.
    const defined = new Set(parsePhelFile(src, 'local').map((d) => d.name));
    const bindings = collectAllBindings(src).filter(
        (b) => table.has(b.name) || deprecatedDefs.has(b.name)
    );

    const locallyBound = (name: string, offset: number): boolean =>
        bindings.some((b) => b.name === name && offset >= b.scopeStart && offset < b.scopeEnd);

    const forms = parseAll(src);
    const spans = syntaxQuoteSpans(src, forms);
    const inSyntaxQuote = (offset: number): boolean =>
        spans.some(([s, e]) => offset >= s && offset < e);

    const visit = (list: readonly Form[], quoted: boolean, syntaxQuoted: boolean): void => {
        for (const form of list) {
            const prefix = src.slice(form.start, form.bodyStart);
            const inQuote = quoted || prefix.includes("'");
            const inSq = syntaxQuoted || prefix.includes('`');
            if (!inQuote && form.kind === 'list' && form.children.length > 0) {
                const head = form.children[0];
                if (head.kind === 'atom') {
                    const name = src.slice(head.bodyStart, head.bodyEnd);
                    const entry = table.get(name);
                    if (entry && !defined.has(name) && !locallyBound(name, head.bodyStart)) {
                        issues.push({
                            start: head.bodyStart,
                            end: head.bodyEnd,
                            name,
                            status: entry.status,
                            ...(entry.replacement === undefined
                                ? {}
                                : {
                                      replacement: entry.replacement,
                                      fix: {
                                          title: `Replace '${name}' with '${entry.replacement}'`,
                                          edits: [
                                              {
                                                  start: head.bodyStart,
                                                  end: head.bodyEnd,
                                                  text: entry.replacement,
                                              },
                                          ],
                                      },
                                  }),
                            message: migrationMessage(entry),
                        });
                    }
                    const def = deprecatedDefs.get(name);
                    if (def && !entry && !locallyBound(name, head.bodyStart)) {
                        issues.push({
                            start: head.bodyStart,
                            end: head.bodyEnd,
                            name,
                            status: 'deprecated',
                            message: deprecatedDefinitionMessage(name, def),
                        });
                    }
                }
            }
            if (!inQuote && (form.kind === 'atom' || form.kind === 'char')) {
                const sep = separatorIssue(src, form);
                if (sep) {
                    issues.push(sep);
                }
            }
            if (inSq && form.kind === 'atom') {
                const name = src.slice(form.bodyStart, form.bodyEnd);
                if (name.length > 1 && name.endsWith('$') && !name.includes('/')) {
                    const entry = SYNTAX_MIGRATIONS.gensym;
                    const replacement = `${name.slice(0, -1)}#`;
                    issues.push({
                        start: form.bodyStart,
                        end: form.bodyEnd,
                        name,
                        status: entry.status,
                        replacement,
                        message: `\`${name}\` auto-gensym was removed in Phel ${entry.since}; write \`${replacement}\`.`,
                        fix: {
                            title: `Replace '${name}' with '${replacement}'`,
                            edits: [{ start: form.bodyEnd - 1, end: form.bodyEnd, text: '#' }],
                        },
                    });
                }
            }
            visit(form.children, inQuote, inSq);
        }
    };

    visit(forms, false, false);
    scanSyntax(src, inSyntaxQuote, issues);
    issues.sort((a, b) => a.start - b.start);
    return issues;
}
