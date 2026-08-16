// Flags calls to core functions Phel 0.50 removed, and to the forms it
// deprecated as source, so the editor can say what to write instead.
//
// Both halves earn their keep for a different reason:
//
//   * The removed aliases are a hard failure on 0.50, and the compiler reports
//     them as an unresolvable symbol. It cannot know that `push` used to mean
//     `conj`, so the useful half of the message only exists here.
//   * The deprecated forms still compile, and the compiler only mentions them
//     under `--warn-deprecations`. A `.phel` buffer would otherwise say nothing
//     about a spelling the language has moved off.
//
// Sources: phel-lang `docs/migration/removed-deprecated-core-fns.md` and the
// deprecated table in `docs/spec/language-surface.md`.
//
// Pure — no `vscode` import, so the detection is unit-testable and can be run
// over a corpus by `scripts/sweep-analyzers.mjs`.

import { parseAll, type Form } from './phelParedit';
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
 * The 0.50 migration table. `removed` entries are the long-deprecated
 * `phel.core` aliases dropped in 0.50; `deprecated` entries are the four forms
 * the language-surface spec froze but superseded.
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

export interface MigrationIssue {
    /** Offset of the head symbol. */
    start: number;
    /** Offset just past the head symbol. */
    end: number;
    name: string;
    status: MigrationStatus;
    /** Set when a plain head swap fixes the call; drives the quick fix. */
    replacement?: string;
    /** Ready-to-render sentence. */
    message: string;
}

/** The message a diagnostic carries, kept here so tests can assert on it. */
export function migrationMessage(entry: MigrationEntry): string {
    const verb =
        entry.status === 'removed'
            ? `was removed in Phel ${entry.since}`
            : `is deprecated as source since Phel ${entry.since}`;
    return `\`${entry.name}\` ${verb}; ${entry.detail}.`;
}

/**
 * Find every call to a removed or deprecated name in `src`.
 *
 * Only the head of a list is considered. The removed names are ordinary words
 * — `values`, `id` and `put` are common binding names and map keys — so a
 * scanner that matched every occurrence would fire constantly on correct code.
 * Two further guards keep it quiet: a name the file defines itself, and a name
 * a local binding shadows at that point, are both left alone.
 *
 * Quoted forms are skipped: `'(push 1 2)` is data, not a call. A syntax-quote
 * is not, since a macro template expands into a real call site.
 */
export function findMigrationIssues(src: string): MigrationIssue[] {
    const table = new Map(MIGRATIONS.map((e) => [e.name, e]));
    const issues: MigrationIssue[] = [];

    // Names this file introduces itself; its `push` is not phel.core's.
    const defined = new Set(parsePhelFile(src, 'local').map((d) => d.name));
    const bindings = collectAllBindings(src).filter((b) => table.has(b.name));

    const shadowed = (name: string, offset: number): boolean =>
        defined.has(name) ||
        bindings.some((b) => b.name === name && offset >= b.scopeStart && offset < b.scopeEnd);

    const visit = (forms: readonly Form[], quoted: boolean): void => {
        for (const form of forms) {
            const prefix = src.slice(form.start, form.bodyStart);
            const inQuote = quoted || prefix.includes("'");
            if (!inQuote && form.kind === 'list' && form.children.length > 0) {
                const head = form.children[0];
                if (head.kind === 'atom') {
                    const name = src.slice(head.bodyStart, head.bodyEnd);
                    const entry = table.get(name);
                    if (entry && !shadowed(name, head.bodyStart)) {
                        issues.push({
                            start: head.bodyStart,
                            end: head.bodyEnd,
                            name,
                            status: entry.status,
                            ...(entry.replacement === undefined
                                ? {}
                                : { replacement: entry.replacement }),
                            message: migrationMessage(entry),
                        });
                    }
                }
            }
            visit(form.children, inQuote);
        }
    };

    visit(parseAll(src), false);
    issues.sort((a, b) => a.start - b.start);
    return issues;
}
