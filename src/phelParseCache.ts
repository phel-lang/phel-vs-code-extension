// One parse cache shared by every analyzer.
//
// A single keystroke fans out into several passes over the same buffer —
// diagnostics, folding, semantic tokens, unused locals, form highlight,
// completion context — and each of them used to call `parseAll` again. The
// scope analyzer had a private one-entry cache for its own hot loop; this is
// that idea, made shared and slightly larger.
//
// Keyed by the *source string*, not by uri + version:
//
//   * a stale buffer can never be served — different text is a different key;
//   * identical text under a new version (undo, a save that changes nothing,
//     the same file open twice) still hits;
//   * it keeps the module free of `vscode`, so `npm run sweep` and the unit
//     tests exercise the very same code path production does.
//
// The comparison is V8 string equality: length check, then memcmp — µs for a
// 200 KB file, against the milliseconds a re-parse costs.
//
// Capacity is 8 entries, LRU: enough for the handful of documents a pass
// touches (the active editor plus whatever a workspace-wide command walks),
// small enough that the retained trees stay bounded.

import { parseAll, type Form } from './phelParedit';

const CAPACITY = 8;

interface Entry {
    src: string;
    forms: readonly Form[];
    /** Anything else derived from this exact source, memoised by key. */
    derived: Map<string, unknown>;
}

/** Least-recently-used first, most-recently-used last. */
const entries: Entry[] = [];

function entryFor(src: string): Entry {
    const index = entries.findIndex((e) => e.src === src);
    if (index >= 0) {
        const hit = entries[index];
        if (index !== entries.length - 1) {
            entries.splice(index, 1);
            entries.push(hit);
        }
        return hit;
    }
    const entry: Entry = { src, forms: parseAll(src), derived: new Map() };
    entries.push(entry);
    if (entries.length > CAPACITY) {
        entries.shift();
    }
    return entry;
}

/** Top-level forms of `src`, parsed once per distinct source. */
export function parseAllCached(src: string): readonly Form[] {
    return entryFor(src).forms;
}

/**
 * Memoise `compute()` against `src` under `key`. Used for per-source results
 * that are as expensive as the parse itself — occurrences by name, say, where
 * a pass rescans the full text once per binding and bindings share names
 * heavily (410 bindings over 158 distinct names in phel's own `test.phel`).
 *
 * The entry dies with its source, so a derived value can never outlive the
 * text it was computed from.
 */
export function derive<T>(src: string, key: string, compute: () => T): T {
    const entry = entryFor(src);
    if (entry.derived.has(key)) {
        return entry.derived.get(key) as T;
    }
    const value = compute();
    entry.derived.set(key, value);
    return value;
}
