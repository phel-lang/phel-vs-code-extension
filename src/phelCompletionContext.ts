// What the cursor is *inside*, for the completion provider. Two contexts get
// their own candidate list instead of the flat "every core symbol" one:
//
//   1. `alias/…` — an alias introduced by `[some.ns :as alias]`. Hover,
//      go-to-definition and signature help already resolve these; completion
//      used to offer nothing, because every candidate label is a bare name.
//   2. inside the `(ns …)` form — where core symbols are noise and the useful
//      candidates are the clause keywords, the entry options, and the
//      namespaces the workspace actually has.
//
// Pure: no `vscode` import, so the decisions are unit-testable.

import { parseAll, pathAt, type Form } from './phelParedit';
import { aliasMapFromSource } from './phelNsAnalyzer';
import type { PhelDoc } from './phelDocs';

/** Clause heads a `(ns …)` form accepts, per the compiler's `NsSymbol`. */
export const NS_CLAUSES: readonly string[] = [':require', ':use', ':require-file'];
/** Options a single `:require` entry accepts, per the same source. */
export const NS_ENTRY_OPTIONS: readonly string[] = [':as', ':refer'];

export type CompletionContext =
    | { kind: 'normal' }
    /** Typing `alias/name`; `ns` is the namespace the alias resolves to. */
    | { kind: 'alias-qualified'; alias: string; ns: string }
    /** Inside `(ns …)`: a clause head like `(:require …)` is expected. */
    | { kind: 'ns-clause' }
    /** Inside `(:require …)` / `(:use …)`, outside any entry vector. */
    | { kind: 'ns-namespace' }
    /** Inside a `[some.ns …]` entry, past the namespace symbol. */
    | { kind: 'ns-entry-option' };

/**
 * The alias being typed, when the token under the cursor looks like
 * `alias/partial`. Returns null for a bare token, for a leading `/`, and for
 * `php/…`, which is interop rather than a namespace alias.
 */
export function aliasPrefix(linePrefix: string): string | null {
    const match = /([A-Za-z0-9_!?*+<>=.\-$&%]+)\/[A-Za-z0-9_!?*+<>=.\-$&%]*$/.exec(linePrefix);
    if (!match) {
        return null;
    }
    const alias = match[1];
    return alias === 'php' ? null : alias;
}

function atomText(src: string, form: Form): string {
    return src.slice(form.bodyStart, form.bodyEnd);
}

function headText(src: string, form: Form): string | null {
    const head = form.children[0];
    return head && head.kind === 'atom' ? atomText(src, head) : null;
}

/**
 * Classify the cursor. `linePrefix` is the text before the cursor on its own
 * line; `offset` is the same position as a document offset.
 */
export function completionContextAt(
    src: string,
    offset: number,
    linePrefix: string
): CompletionContext {
    const alias = aliasPrefix(linePrefix);
    if (alias) {
        const ns = aliasMapFromSource(src).get(alias);
        if (ns) {
            return { kind: 'alias-qualified', alias, ns };
        }
        // An unknown alias is still a qualified position: offering the flat
        // core list there would only produce noise, so fall through to normal
        // handling and let the provider filter as usual.
    }

    const path = pathAt(parseAll(src), offset);
    const nsIndex = path.findIndex((f) => f.kind === 'list' && headText(src, f) === 'ns');
    if (nsIndex < 0) {
        return { kind: 'normal' };
    }

    // Innermost list under the `(ns …)` form decides the sub-context.
    for (let i = path.length - 1; i > nsIndex; i--) {
        const form = path[i];
        if (form.kind === 'vector') {
            // `[some.ns :as x]` — past the namespace symbol, options are next.
            return { kind: 'ns-entry-option' };
        }
        if (form.kind === 'list') {
            const head = headText(src, form);
            if (head && NS_CLAUSES.includes(head)) {
                return { kind: 'ns-namespace' };
            }
        }
    }
    return { kind: 'ns-clause' };
}

/** A completion candidate produced by one of the qualified contexts. */
export interface QualifiedCandidate {
    /** Text to insert and match on, e.g. `str/blank?`. */
    label: string;
    /** Bare symbol name, for the docs lookup. */
    name: string;
    kind: 'macro' | 'fn' | 'def';
    detail: string;
}

/**
 * Every public symbol of `ns`, labelled with the alias so the label matches
 * what the user is typing (`str/blank?`).
 */
export function aliasQualifiedCandidates(
    alias: string,
    ns: string,
    docs: readonly PhelDoc[]
): QualifiedCandidate[] {
    const seen = new Set<string>();
    const out: QualifiedCandidate[] = [];
    for (const doc of docs) {
        if (doc.ns !== ns || doc.private || seen.has(doc.name)) {
            continue;
        }
        seen.add(doc.name);
        out.push({
            label: `${alias}/${doc.name}`,
            name: doc.name,
            kind: doc.kind === 'macro' ? 'macro' : doc.kind === 'def' ? 'def' : 'fn',
            detail: `${ns}/${doc.name}`,
        });
    }
    return out;
}

/**
 * Namespaces offerable inside `(:require …)`: every namespace known to the
 * corpus or the workspace, minus the file's own and the ones it already
 * requires.
 */
export function requirableNamespaces(
    src: string,
    docs: readonly PhelDoc[],
    ownNs?: string,
    alreadyRequired: readonly string[] = []
): string[] {
    const skip = new Set<string>(alreadyRequired);
    if (ownNs) {
        skip.add(ownNs);
    }
    const out = new Set<string>();
    for (const doc of docs) {
        if (doc.ns && !skip.has(doc.ns)) {
            out.add(doc.ns);
        }
    }
    return [...out].sort();
}
