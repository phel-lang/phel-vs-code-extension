// In-memory index of every `defn` / `defmacro` / `def` form discovered in
// the user's workspace. Pure storage layer: callers feed it parser output
// keyed by absolute file path; the VS Code wrapper handles file watching.
//
// Each indexed doc carries the originating file as `sourceUri` so providers
// can build go-to-definition responses, and inherits `line` / `column` from
// the parser.

import type { PhelDoc } from './phelDocs';

/**
 * A `PhelDoc` enriched with the file it came from. The base `PhelDoc`
 * already carries `line` / `column` populated by the parser.
 */
export interface WorkspaceDoc extends PhelDoc {
    /** Absolute path of the source file this doc came from. */
    sourceFile: string;
}

export class PhelWorkspaceIndex {
    private readonly perFile = new Map<string, WorkspaceDoc[]>();

    /** Replace the docs known for `file`. Pass `[]` to clear. */
    setFile(file: string, docs: PhelDoc[]): void {
        if (docs.length === 0) {
            this.perFile.delete(file);
            return;
        }
        this.perFile.set(
            file,
            docs.map((d) => ({ ...d, sourceFile: file }))
        );
    }

    /** Forget every doc that came from `file`. */
    removeFile(file: string): void {
        this.perFile.delete(file);
    }

    /** Forget everything. */
    clear(): void {
        this.perFile.clear();
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

    /** Number of indexed files. */
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
