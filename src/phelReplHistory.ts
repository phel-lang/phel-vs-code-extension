// Reading back `.vscode/phel-repl-history.phel`, the file the REPL provider
// appends every sent form to as `;; <ISO stamp>` + the form + a blank line.
// Pure, so the parser is unit-testable without a workspace.
//
// The file is written while the editor runs and can be cut short by a crash or
// a full disk, so nothing here assumes a well-formed tail: an entry is a stamp
// line plus whatever follows it, and a stamp with nothing under it is dropped.
// A form recalled twice is one entry — the picker shows history, not a log.

export interface ReplHistoryEntry {
    /** The ISO timestamp the entry was written with. */
    stamp: string;
    /** The form as it was sent (flattened to one line by the REPL provider). */
    form: string;
}

/** `;; 2026-08-16T09:12:33.004Z` — the header `appendHistory` writes. */
const STAMP_RE = /^;;\s+(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s*$/;

/** Every distinct form in `text`, newest first. */
export function parseReplHistory(text: string): ReplHistoryEntry[] {
    const entries: ReplHistoryEntry[] = [];
    let stamp: string | undefined;
    let lines: string[] = [];

    const flush = (): void => {
        const form = lines.join('\n').trim();
        if (stamp !== undefined && form !== '') {
            entries.push({ stamp, form });
        }
        stamp = undefined;
        lines = [];
    };

    for (const line of text.split(/\r?\n/)) {
        const match = STAMP_RE.exec(line);
        if (match) {
            flush();
            stamp = match[1];
            continue;
        }
        // Anything before the first stamp is not part of an entry.
        if (stamp !== undefined) {
            lines.push(line);
        }
    }
    flush();

    const seen = new Set<string>();
    const newestFirst: ReplHistoryEntry[] = [];
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (seen.has(entry.form)) {
            continue; // an older send of a form already listed
        }
        seen.add(entry.form);
        newestFirst.push(entry);
    }
    return newestFirst;
}
