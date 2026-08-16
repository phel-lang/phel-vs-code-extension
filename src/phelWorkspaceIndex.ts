// In-memory index of every `defn` / `defmacro` / `def` form discovered in
// the user's workspace. Pure storage layer: callers feed it parser output
// keyed by absolute file path; the VS Code wrapper handles file watching.
//
// Each indexed doc carries the originating file as `sourceUri` so providers
// can build go-to-definition responses, and inherits `line` / `column` from
// the parser.
//
// Alongside the docs it keeps, per file, how often each symbol token is written
// there. Summed across files that answers "how many references" in one map
// lookup, which is what the reference CodeLens needs: recomputing it per lens
// would mean rereading the whole workspace on every keystroke.

import type { PhelDoc } from './phelDocs';

/**
 * A `PhelDoc` enriched with the file it came from. The base `PhelDoc`
 * already carries `line` / `column` populated by the parser.
 */
export interface WorkspaceDoc extends PhelDoc {
    /** Absolute path of the source file this doc came from. */
    sourceFile: string;
}

/** No token tally for a file, for callers that only care about its docs. */
const NO_COUNTS: ReadonlyMap<string, number> = new Map();

export class PhelWorkspaceIndex {
    private readonly perFile = new Map<string, WorkspaceDoc[]>();
    /** How often each symbol token is written, per file. */
    private readonly countsPerFile = new Map<string, ReadonlyMap<string, number>>();
    /** The same tallies summed across every file, kept in step with them. */
    private readonly totals = new Map<string, number>();

    /**
     * Replace the docs known for `file`, and the tally of the symbol tokens it
     * writes. A file that defines nothing stays in the index with no docs
     * rather than dropping out of it: find-references scans the files this
     * index knows, and a benchmark file or a script uses plenty of symbols
     * while defining none. `removeFile` is what forgets one.
     */
    setFile(file: string, docs: PhelDoc[], counts: ReadonlyMap<string, number> = NO_COUNTS): void {
        this.perFile.set(
            file,
            docs.map((d) => ({ ...d, sourceFile: file }))
        );
        this.replaceCounts(file, counts);
    }

    /**
     * How often `name` is written as a symbol token across every indexed file,
     * counting a qualified `s/name` as a use of `name`. One map lookup, which
     * is what makes it usable from a CodeLens.
     */
    occurrenceCount(name: string): number {
        return this.totals.get(name) ?? 0;
    }

    /** The same tally for one file — what an unsaved buffer supersedes. */
    occurrenceCountIn(file: string, name: string): number {
        return this.countsPerFile.get(file)?.get(name) ?? 0;
    }

    /** Every file that has been indexed, including those that define nothing. */
    files(): string[] {
        return [...this.perFile.keys()];
    }

    /** Forget every doc that came from `file`. */
    removeFile(file: string): void {
        this.perFile.delete(file);
        this.replaceCounts(file, NO_COUNTS);
        this.countsPerFile.delete(file);
    }

    /** Forget everything. */
    clear(): void {
        this.perFile.clear();
        this.countsPerFile.clear();
        this.totals.clear();
    }

    /** All workspace docs across every indexed file. */
    allDocs(): WorkspaceDoc[] {
        const out: WorkspaceDoc[] = [];
        for (const fileDocs of this.perFile.values()) {
            for (const d of fileDocs) {
                out.push(d);
            }
        }
        return out;
    }

    /** Number of indexed files, whether or not they define anything. */
    fileCount(): number {
        return this.perFile.size;
    }

    /** Number of indexed docs across all files. */
    docCount(): number {
        let n = 0;
        for (const fileDocs of this.perFile.values()) {
            n += fileDocs.length;
        }
        return n;
    }

    /** Docs that came from a specific file. */
    docsForFile(file: string): WorkspaceDoc[] {
        return this.perFile.get(file) ?? [];
    }

    /**
     * Swap one file's tally, keeping `totals` exact. Subtracting the old one
     * first is what makes a re-index of the same file idempotent; a name that
     * falls to zero is dropped so the map does not grow with every rename.
     */
    private replaceCounts(file: string, counts: ReadonlyMap<string, number>): void {
        for (const [name, n] of this.countsPerFile.get(file) ?? NO_COUNTS) {
            const left = (this.totals.get(name) ?? 0) - n;
            if (left > 0) {
                this.totals.set(name, left);
            } else {
                this.totals.delete(name);
            }
        }
        this.countsPerFile.set(file, counts);
        for (const [name, n] of counts) {
            this.totals.set(name, (this.totals.get(name) ?? 0) + n);
        }
    }
}

/**
 * Merge workspace and core doc corpora into a single array. Workspace docs
 * win when a name collides, since they reflect the user's current code.
 */
export function combineDocs(workspace: WorkspaceDoc[], core: readonly PhelDoc[]): PhelDoc[] {
    const seen = new Set<string>();
    const out: PhelDoc[] = [];
    for (const d of workspace) {
        out.push(d);
        seen.add(d.qualifiedName);
    }
    for (const d of core) {
        if (!seen.has(d.qualifiedName)) {
            out.push(d);
        }
    }
    return out;
}
