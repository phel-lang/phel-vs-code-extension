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

import { pathAt, type Form } from './phelParedit';
import { parseAllCached } from './phelParseCache';
import { aliasMapFromSource, normalizeNs } from './phelNsAnalyzer';
import type { PhelDoc } from './phelDocs';

/** Clause heads a `(ns …)` form accepts, per the compiler's `NsSymbol`. */
export const NS_CLAUSES: readonly string[] = [':require', ':use', ':require-file'];
/** Options a single `:require` entry accepts, per the same source. */
export const NS_ENTRY_OPTIONS: readonly string[] = [':as', ':refer'];
/**
 * Options a `:use` entry accepts. `:use` imports a PHP class, not a Phel
 * namespace, and `UseAliasRegistrar` rejects anything but `:as`.
 */
export const NS_USE_OPTIONS: readonly string[] = [':as'];

export type CompletionContext =
    | { kind: 'normal' }
    /** Typing `alias/name`; `ns` is the namespace the alias resolves to. */
    | { kind: 'alias-qualified'; alias: string; ns: string }
    /** Inside `(ns …)`: a clause head like `(:require …)` is expected. */
    | { kind: 'ns-clause' }
    /**
     * Inside a clause body, outside any entry vector. `clause` says which one,
     * because they take different things: `:require` a Phel namespace,
     * `:use` a PHP class, `:require-file` a path string.
     */
    | { kind: 'ns-namespace'; clause: string }
    /** Inside a `[some.ns …]` entry, past the namespace symbol. */
    | { kind: 'ns-entry-option' }
    /** Inside a `:refer [...]` vector; `ns` is the namespace being referred. */
    | { kind: 'ns-refer'; ns: string };

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
 * When `vec` is the argument of a `:refer` keyword, the namespace whose names
 * it lists; otherwise null.
 *
 * Both require shapes are handled, because `:refer` sits in a different parent
 * in each: inside the entry vector for `[some.ns :refer [a]]`, and directly
 * inside the clause for the flat `some.ns :refer [a]`. In both, the namespace
 * is the last plain symbol before the `:refer`.
 */
function referTargetNs(src: string, parent: Form | undefined, vec: Form): string | null {
    if (!parent || (parent.kind !== 'vector' && parent.kind !== 'list')) {
        return null;
    }
    const kids = parent.children;
    const index = kids.indexOf(vec);
    if (index < 1) {
        return null;
    }
    const keyword = kids[index - 1];
    if (keyword.kind !== 'atom' || atomText(src, keyword) !== ':refer') {
        return null;
    }
    // Scan forward so an option's *argument* is never mistaken for the
    // namespace: in `[some.ns :as x :refer [...]]` the atom directly before
    // `:refer` is `x`, the alias.
    let ns: string | null = null;
    // For the flat shape the parent is the `(:require …)` list, whose head is
    // a keyword but not an option, so it takes no argument.
    const start = parent.kind === 'list' ? 1 : 0;
    for (let i = start; i < index - 1; i++) {
        const kid = kids[i];
        if (kid.kind !== 'atom') {
            continue;
        }
        const text = atomText(src, kid);
        if (text.startsWith(':')) {
            i++; // skip this option's argument
            continue;
        }
        ns = normalizeNs(text);
    }
    return ns;
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

    const path = pathAt(parseAllCached(src), offset);
    const nsIndex = path.findIndex((f) => f.kind === 'list' && headText(src, f) === 'ns');
    if (nsIndex < 0) {
        return { kind: 'normal' };
    }

    // Innermost list under the `(ns …)` form decides the sub-context.
    for (let i = path.length - 1; i > nsIndex; i--) {
        const form = path[i];
        if (form.kind === 'vector') {
            // `:refer [a b]` — the names come from the entry's namespace, not
            // from the option keywords.
            const referNs = referTargetNs(src, path[i - 1], form);
            if (referNs !== null) {
                return { kind: 'ns-refer', ns: referNs };
            }
            // `[some.ns :as x]` — past the namespace symbol, options are next.
            return { kind: 'ns-entry-option' };
        }
        if (form.kind === 'list') {
            const head = headText(src, form);
            if (head && NS_CLAUSES.includes(head)) {
                return { kind: 'ns-namespace', clause: head };
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

/** Public names of `ns`, offerable inside its `:refer [...]` vector. */
export function referableNames(ns: string, docs: readonly PhelDoc[]): string[] {
    const out = new Set<string>();
    for (const doc of docs) {
        if (doc.ns === ns && !doc.private) {
            out.add(doc.name);
        }
    }
    return [...out].sort();
}
