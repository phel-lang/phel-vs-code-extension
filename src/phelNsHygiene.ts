// Which `(:require ...)` entries a file does not use, and the edits that tidy
// them away.
//
// `phel lint` already has this rule (`phel/unused-require`), and the detector
// below is a copy of its decision procedure so the finding arrives while you
// type rather than on the next save: an entry is unused when neither the alias
// it binds - `:as`, or the last segment of the namespace, which is what
// `SymbolAlias::lastSegment` computes - nor any of its `:refer` names appears
// anywhere outside the `(ns ...)` form.
//
// The one thing it adds is per-name granularity. Phel reports the entry and
// never the single `:refer` nobody uses, because dropping one name out of a
// vector is a text edit and a lint rule only reports forms. We can make that
// edit, so a dead name inside a live entry gets a finding of its own.
//
// Deliberately conservative: any token that reads like the name counts as a
// use, including one inside a syntax-quoted macro template where the expansion
// is what really reaches the namespace. Saying nothing is always safer than
// offering to remove a require the file needs.
//
// No `vscode` imports; the editor wiring lives in `phelNsHygieneProvider.ts`.

import {
    parseNsForm,
    requireEntries,
    type NsForm,
    type RequireClause,
    type RequireEntry,
} from './phelNsAnalyzer';
import { findOccurrences, findQualifiedOccurrences } from './phelReferences';

export type NsHygieneKind = 'require' | 'refer';

export interface NsHygieneIssue {
    /** Whether the whole entry is dead, or only one of its `:refer` names. */
    kind: NsHygieneKind;
    /** Span to fade: the entry, or the single `:refer` name. */
    start: number;
    end: number;
    /** The required namespace, dotted. */
    ns: string;
    /** The unused name, for `kind: 'refer'`. */
    name?: string;
    message: string;
}

/** Replace `[start, end)` in the source with `text`. */
export interface NsEdit {
    start: number;
    end: number;
    text: string;
}

/** Every unused require entry, and every unused `:refer` inside a used one. */
export function findUnusedRequires(src: string): NsHygieneIssue[] {
    const form = parseNsForm(src);
    if (!form || form.requireClauses.length === 0) {
        return [];
    }
    const body = outsideNsForm(src, form);
    const out: NsHygieneIssue[] = [];
    for (const entry of requireEntries(form)) {
        if (!entry.ns) {
            continue; // a shape the parser could not read a namespace out of
        }
        const usedRefers = entry.refer.filter((name) => isUsed(body, name));
        if (usedRefers.length === 0 && !isAliasUsed(body, entry)) {
            out.push(requireIssue(entry));
            continue;
        }
        // The entry is live; a name in its `:refer` vector may still not be.
        for (const referred of referNames(src, entry)) {
            if (!isUsed(body, referred.name)) {
                out.push({
                    kind: 'refer',
                    start: referred.start,
                    end: referred.end,
                    ns: entry.ns,
                    name: referred.name,
                    message: `'${referred.name}' is referred from '${entry.ns}' but never used`,
                });
            }
        }
    }
    return out;
}

/**
 * The require entry covering `[start, end)`, reported as a removable issue.
 *
 * `phel lint` reports the same finding with a range of its own - it anchors on
 * the whole vector, or on the symbol of a flat entry - so the quick fix that
 * answers *its* diagnostic looks the entry up by position rather than trusting
 * a message, and does not re-decide whether the entry is used.
 */
export function requireIssueIn(src: string, start: number, end: number): NsHygieneIssue | null {
    const entry = requireEntries(parseNsForm(src)).find(
        (e) => e.ns !== '' && start <= e.end && end >= e.start
    );
    return entry ? requireIssue(entry) : null;
}

/**
 * The edit that removes what `issue` reports: the one `:refer` name, or the
 * whole entry. A `:refer` vector left empty goes with the name, and an entry
 * that was its clause's last one takes the `(:require ...)` clause with it so
 * the `(ns ...)` form stays valid.
 */
export function removeRequireEdit(src: string, issue: NsHygieneIssue): NsEdit | null {
    for (const clause of parseNsForm(src)?.requireClauses ?? []) {
        const index = clause.entries.findIndex((e) => issue.start >= e.start && issue.end <= e.end);
        if (index < 0) {
            continue;
        }
        return issue.kind === 'refer'
            ? removeReferName(src, clause.entries[index], issue)
            : removeEntry(src, clause, index);
    }
    return null;
}

/**
 * Sort the requires by namespace, or `null` when they already are - which is
 * what makes running this on every save idempotent.
 *
 * Two levels, because both shapes are written: the entries inside each
 * `(:require ...)` clause, and the clauses themselves, which is what a file
 * scaffolded by `phel init` (one clause per namespace) needs. Only they move.
 * The whitespace between them stays where the writer put it, so a clause with
 * one entry per line keeps one entry per line and a single-line one stays on
 * one line.
 */
export function sortRequiresEdit(src: string): NsEdit | null {
    const clauses = parseNsForm(src)?.requireClauses ?? [];
    if (clauses.length === 0) {
        return null;
    }
    const sorted = clauses.map((clause) => sortedEntries(src, clause));
    const order = sortOrder(clauses.map((clause) => clause.entries[0]?.ns ?? ''));
    let text = sorted[order[0]];
    for (let i = 1; i < order.length; i++) {
        text += src.slice(clauses[i - 1].end, clauses[i].start);
        text += sorted[order[i]];
    }
    const start = clauses[0].start;
    const end = clauses[clauses.length - 1].end;
    return text === src.slice(start, end) ? null : { start, end, text };
}

/** One clause's text with its entries in namespace order. */
function sortedEntries(src: string, clause: RequireClause): string {
    const entries = clause.entries;
    if (entries.length < 2) {
        return src.slice(clause.start, clause.end);
    }
    const order = sortOrder(entries.map((entry) => entry.ns));
    let text = src.slice(clause.start, entries[0].start) + slice(src, entries[order[0]]);
    for (let i = 1; i < order.length; i++) {
        text += src.slice(entries[i - 1].end, entries[i].start);
        text += slice(src, entries[order[i]]);
    }
    return text + src.slice(entries[entries.length - 1].end, clause.end);
}

/** The indices of `keys` in byte order, stable so equal keys keep their order. */
function sortOrder(keys: readonly string[]): number[] {
    return keys.map((_, i) => i).sort((a, b) => compare(keys[a], keys[b]) || a - b);
}

function requireIssue(entry: RequireEntry): NsHygieneIssue {
    return {
        kind: 'require',
        start: entry.start,
        end: entry.end,
        ns: entry.ns,
        message: `'${entry.ns}' is required but never used`,
    };
}

/**
 * The source with the `(ns ...)` form blanked out, so scanning it cannot count
 * a require entry as its own use. Blanks rather than cuts: every offset outside
 * the form stays where it was.
 */
function outsideNsForm(src: string, form: NsForm): string {
    return src.slice(0, form.start) + ' '.repeat(form.end - form.start) + src.slice(form.end);
}

function isUsed(body: string, name: string): boolean {
    return name !== '' && findOccurrences(body, name).length > 0;
}

/**
 * Whether the alias this entry binds is used. `(:require phel.json)` binds
 * `json` exactly as `(:require phel\json)` does, and a use is either the bare
 * token (which is how the compiler records the namespace of `json/encode` too)
 * or a symbol qualified with it.
 */
function isAliasUsed(body: string, entry: RequireEntry): boolean {
    const alias = entry.as ?? lastSegment(entry.ns);
    return isUsed(body, alias) || findQualifiedOccurrences(body, alias).length > 0;
}

function lastSegment(ns: string): string {
    const parts = ns.split('.');
    return parts[parts.length - 1] ?? '';
}

interface ReferName {
    name: string;
    start: number;
    end: number;
}

/** Where each name of the entry's `:refer` vector sits in the source. */
function referNames(src: string, entry: RequireEntry): ReferName[] {
    const vector = entry.referVector;
    if (!vector) {
        return [];
    }
    const text = src.slice(vector.start, vector.end);
    const out: ReferName[] = [];
    for (const name of new Set(entry.refer)) {
        for (const at of findOccurrences(text, name)) {
            out.push({ name, start: vector.start + at.start, end: vector.start + at.end });
        }
    }
    return out.sort((a, b) => a.start - b.start);
}

function removeReferName(src: string, entry: RequireEntry, issue: NsHygieneIssue): NsEdit | null {
    const vector = entry.referVector;
    if (!vector) {
        return null;
    }
    const names = referNames(src, entry);
    const index = names.findIndex((n) => n.start === issue.start && n.end === issue.end);
    if (index < 0) {
        return null;
    }
    if (names.length === 1) {
        // Nothing would be left in the brackets; `:refer []` is noise, and an
        // entry with neither `:refer` nor `:as` still binds its default alias.
        const keyword = src.lastIndexOf(':refer', vector.start);
        if (keyword < entry.start) {
            return null;
        }
        return { start: eatSpaceBefore(src, keyword), end: vector.end, text: '' };
    }
    if (index + 1 < names.length) {
        return { start: names[index].start, end: names[index + 1].start, text: '' };
    }
    return { start: names[index - 1].end, end: names[index].end, text: '' };
}

function removeEntry(src: string, clause: RequireClause, index: number): NsEdit {
    const entries = clause.entries;
    if (entries.length === 1) {
        // An empty `(:require)` is legal but pointless; drop the clause, and
        // the whitespace that separated it from the rest of the `(ns ...)`.
        return { start: eatSpaceBefore(src, clause.start), end: clause.end, text: '' };
    }
    if (index + 1 < entries.length) {
        return { start: entries[index].start, end: entries[index + 1].start, text: '' };
    }
    return { start: entries[index - 1].end, end: entries[index].end, text: '' };
}

/** `at`, moved back over the whitespace in front of it. */
function eatSpaceBefore(src: string, at: number): number {
    let start = at;
    while (start > 0 && /\s/.test(src[start - 1])) {
        start--;
    }
    return start;
}

function slice(src: string, entry: RequireEntry): string {
    return src.slice(entry.start, entry.end);
}

/** Byte order, not locale order: the same source has to sort the same way. */
function compare(a: string, b: string): number {
    if (a === b) {
        return 0;
    }
    return a < b ? -1 : 1;
}
