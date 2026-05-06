// Pure helpers for the `Phel: Show Doc` command. Builds quick-pick items
// from the docs DB so the command can offer search-and-show without doing
// any VS Code-specific work in this module.

import type { PhelDoc } from './phelDocs';

export interface QuickPickEntry {
    /** Label shown on the left of the quick-pick row. */
    label: string;
    /** Description shown next to the label, e.g. the signature. */
    description: string;
    /** Detail line shown beneath, typically the first line of the docstring. */
    detail: string;
    /** Underlying doc record so the command can render it. */
    doc: PhelDoc;
}

/**
 * Build quick-pick entries from a docs corpus. Excludes private symbols by
 * default. Sort order: `phel.core` first (it is the auto-imported namespace
 * users hit most), then alphabetical by qualified name.
 */
export function buildQuickPickEntries(
    docs: readonly PhelDoc[],
    options: { includePrivate?: boolean } = {}
): QuickPickEntry[] {
    const { includePrivate = false } = options;
    const filtered = includePrivate ? docs : docs.filter((d) => !d.private);
    const sorted = [...filtered].sort(compareDocs);
    return sorted.map(toEntry);
}

function compareDocs(a: PhelDoc, b: PhelDoc): number {
    if (a.ns === b.ns) {
        return a.name.localeCompare(b.name);
    }
    if (a.ns === 'phel.core') {
        return -1;
    }
    if (b.ns === 'phel.core') {
        return 1;
    }
    return a.qualifiedName.localeCompare(b.qualifiedName);
}

function toEntry(doc: PhelDoc): QuickPickEntry {
    return {
        label: doc.name,
        description: descriptionFor(doc),
        detail: detailFor(doc),
        doc,
    };
}

function descriptionFor(doc: PhelDoc): string {
    const parts: string[] = [doc.ns];
    if (doc.signature) {
        parts.push(doc.signature);
    }
    return parts.join(' · ');
}

function detailFor(doc: PhelDoc): string {
    if (!doc.doc) {
        return kindLabel(doc);
    }
    const firstLine = doc.doc.split(/\r?\n/, 1)[0].trim();
    return firstLine.length > 0 ? firstLine : kindLabel(doc);
}

function kindLabel(doc: PhelDoc): string {
    const visibility = doc.private ? 'private ' : '';
    switch (doc.kind) {
        case 'fn':
            return `${visibility}function`;
        case 'macro':
            return `${visibility}macro`;
        case 'def':
            return `${visibility}def`;
    }
}
