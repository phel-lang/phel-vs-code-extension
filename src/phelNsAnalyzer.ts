// Pure analysis of the `(ns ...)` form at the top of a Phel file. The
// completion provider uses this to decide whether a chosen workspace symbol
// needs a new `:require` entry, and to build the text edit that adds it.
//
// Only the shapes Phel actually emits are handled:
//
//   (ns my.app)
//   (ns my.app
//     (:require [other.ns :refer [a b] :as o]))

import { parseAll, type Form } from './phelParedit';

export interface RequireEntry {
    /** Span of the `[other.ns ...]` vector. */
    start: number;
    end: number;
    ns: string;
    /** Span of the `[a b ...]` `:refer` vector, if any. */
    referVector?: { start: number; end: number };
    /** Names listed in `:refer [...]`. Empty when there is no `:refer`. */
    refer: string[];
    /** Alias from `:as`, if present. */
    as?: string;
}

export interface RequireClause {
    /** Span of the `(:require ...)` list. */
    start: number;
    end: number;
    entries: RequireEntry[];
}

export interface NsForm {
    /** Span of the entire `(ns ...)` list. */
    start: number;
    end: number;
    /** Position just before the closing `)` of the ns form (for inserts). */
    closeOffset: number;
    name: string;
    requireClause: RequireClause | null;
}

export function parseNsForm(src: string): NsForm | null {
    const forms = parseAll(src);
    for (const form of forms) {
        if (form.kind !== 'list' || form.children.length === 0) {
            continue;
        }
        const head = form.children[0];
        if (head.kind !== 'atom') {
            continue;
        }
        if (atomText(src, head) !== 'ns') {
            continue;
        }
        const nameChild = form.children[1];
        if (!nameChild || nameChild.kind !== 'atom') {
            return null;
        }
        const name = atomText(src, nameChild);
        const requireClause = findRequireClause(src, form);
        return {
            start: form.start,
            end: form.end,
            closeOffset: form.innerEnd,
            name,
            requireClause,
        };
    }
    return null;
}

function atomText(src: string, atom: Form): string {
    return src.slice(atom.start, atom.end);
}

function findRequireClause(src: string, ns: Form): RequireClause | null {
    for (const child of ns.children) {
        if (child.kind !== 'list' || child.children.length === 0) {
            continue;
        }
        const head = child.children[0];
        if (head.kind !== 'atom') {
            continue;
        }
        if (atomText(src, head) !== ':require') {
            continue;
        }
        return {
            start: child.start,
            end: child.end,
            entries: child.children.slice(1).map((entry) => parseRequireEntry(src, entry)),
        };
    }
    return null;
}

function parseRequireEntry(src: string, entry: Form): RequireEntry {
    if (entry.kind === 'atom') {
        return {
            start: entry.start,
            end: entry.end,
            ns: atomText(src, entry),
            refer: [],
        };
    }
    if (entry.kind !== 'vector' || entry.children.length === 0) {
        return {
            start: entry.start,
            end: entry.end,
            ns: '',
            refer: [],
        };
    }
    const nsAtom = entry.children[0];
    const ns = nsAtom.kind === 'atom' ? atomText(src, nsAtom) : '';
    let refer: string[] = [];
    let referVector: { start: number; end: number } | undefined;
    let as: string | undefined;
    for (let i = 1; i < entry.children.length; i++) {
        const kw = entry.children[i];
        if (kw.kind !== 'atom') {
            continue;
        }
        const text = atomText(src, kw);
        const next = entry.children[i + 1];
        if (text === ':refer' && next?.kind === 'vector') {
            refer = next.children.filter((c) => c.kind === 'atom').map((c) => atomText(src, c));
            referVector = { start: next.start, end: next.end };
            i++;
        } else if (text === ':as' && next?.kind === 'atom') {
            as = atomText(src, next);
            i++;
        }
    }
    return { start: entry.start, end: entry.end, ns, refer, referVector, as };
}

export interface RequireEdit {
    /** Offset where the new text should be inserted. */
    insertAt: number;
    text: string;
}

/**
 * Compute the edit needed so `targetNs/name` is reachable as the bare token
 * `name` from the file whose ns form is `nsForm`. Returns null when no edit
 * is necessary (already imported, or no `(ns ...)` form to amend).
 */
export function buildRequireEdit(
    nsForm: NsForm | null,
    targetNs: string,
    name: string
): RequireEdit | null {
    if (!nsForm) {
        return null;
    }
    if (!targetNs || !name) {
        return null;
    }
    if (nsForm.name === targetNs) {
        return null;
    }

    if (!nsForm.requireClause) {
        return {
            insertAt: nsForm.closeOffset,
            text: `\n  (:require [${targetNs} :refer [${name}]])`,
        };
    }

    const existing = nsForm.requireClause.entries.find((e) => e.ns === targetNs);
    if (!existing) {
        return {
            insertAt: nsForm.requireClause.end - 1,
            text: `\n            [${targetNs} :refer [${name}]]`,
        };
    }

    if (existing.refer.includes(name)) {
        return null;
    }

    if (existing.referVector) {
        const referText = existing.refer.length === 0 ? name : ` ${name}`;
        return {
            insertAt: existing.referVector.end - 1,
            text: referText,
        };
    }

    return {
        insertAt: existing.end - 1,
        text: ` :refer [${name}]`,
    };
}
