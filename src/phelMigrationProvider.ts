// Surfaces `findMigrationIssues` as diagnostics on a `.phel` buffer.
//
// Mirrors `PhelUnusedLocals`: its own collection, refreshed debounced as the
// document changes, so the hint arrives while typing rather than on save.
// Removed names and syntax are warnings, since they no longer compile;
// deprecated forms are hints carrying `DiagnosticTag.Deprecated`, which
// renders as a strikethrough and stays out of the Problems panel's error count.

import * as vscode from 'vscode';
import { type DeprecatedDefinition, findMigrationIssues } from './phelMigration';
import { PHEL_DOCS } from './phelCoreDocs';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';

const MAX_CHARS = 200_000;
const DEBOUNCE_MS = 250;

/** Marks a diagnostic as ours, so the quick fix can recognise it. */
export const MIGRATION_SOURCE = 'phel';
export const MIGRATION_CODE = 'phel-migration';

/** True when the user has not turned the 0.50 migration hints off. */
export function migrationEnabled(): boolean {
    return vscode.workspace.getConfiguration('phel').get<boolean>('migration.enabled', true);
}

/**
 * Every definition the workspace marks `:deprecated`, keyed by bare name, as
 * seen from `file`. A name the file defines itself is read from that file
 * alone: its own `parse` is not another namespace's deprecated `parse`, and
 * its own deprecated `parse` is still deprecated when it calls itself.
 */
export function deprecatedDefinitionsFor(
    indexer: PhelWorkspaceIndexer | undefined,
    file: string
): ReadonlyMap<string, DeprecatedDefinition> {
    const map = new Map<string, DeprecatedDefinition>();
    const record = (name: string, deprecated: string, supersededBy: string | undefined): void => {
        map.set(name, supersededBy === undefined ? { deprecated } : { deprecated, supersededBy });
    };
    for (const doc of PHEL_DOCS) {
        if (doc.deprecated !== undefined) {
            record(doc.name, doc.deprecated, doc.supersededBy);
        }
    }
    if (!indexer) {
        return map;
    }
    const own = [];
    for (const doc of indexer.index.allDocs()) {
        if (doc.sourceFile === file) {
            own.push(doc);
        } else if (doc.deprecated !== undefined) {
            record(doc.name, doc.deprecated, doc.supersededBy);
        }
    }
    for (const doc of own) {
        if (doc.deprecated !== undefined) {
            record(doc.name, doc.deprecated, doc.supersededBy);
        } else {
            map.delete(doc.name);
        }
    }
    return map;
}

/** Owns a diagnostic collection updated (debounced) as `.phel` buffers change. */
export class PhelMigrationDiagnostics implements vscode.Disposable {
    private readonly collection = vscode.languages.createDiagnosticCollection('phel-migration');
    private readonly subs: vscode.Disposable[] = [];
    private readonly timers = new Map<string, NodeJS.Timeout>();

    constructor(private readonly indexer?: PhelWorkspaceIndexer) {
        this.subs.push(
            vscode.workspace.onDidOpenTextDocument((d) => this.schedule(d)),
            vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document)),
            vscode.workspace.onDidCloseTextDocument((d) => {
                this.collection.delete(d.uri);
                this.cancel(d.uri.toString());
            }),
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('phel.migration.enabled')) {
                    this.refreshAll();
                }
            })
        );
        if (indexer) {
            // A `:deprecated` added to a definition elsewhere changes every
            // call site's diagnostics.
            this.subs.push(indexer.onDidChange(() => this.refreshAll()));
        }
        this.refreshAll();
    }

    private refreshAll(): void {
        for (const d of vscode.workspace.textDocuments) {
            this.refresh(d);
        }
    }

    private cancel(key: string): void {
        const timer = this.timers.get(key);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(key);
        }
    }

    private schedule(doc: vscode.TextDocument): void {
        if (doc.languageId !== 'phel') {
            return;
        }
        const key = doc.uri.toString();
        this.cancel(key);
        this.timers.set(
            key,
            setTimeout(() => {
                this.timers.delete(key);
                this.refresh(doc);
            }, DEBOUNCE_MS)
        );
    }

    private refresh(doc: vscode.TextDocument): void {
        if (doc.languageId !== 'phel') {
            return;
        }
        if (!migrationEnabled()) {
            this.collection.delete(doc.uri);
            return;
        }
        const src = doc.getText();
        if (src.length > MAX_CHARS) {
            // Too large to analyse on every change; clear stale results.
            this.collection.delete(doc.uri);
            return;
        }
        const issues = findMigrationIssues(src, {
            deprecatedDefinitions: deprecatedDefinitionsFor(this.indexer, doc.uri.fsPath),
        });
        const diags = issues.map((issue) => {
            const range = new vscode.Range(doc.positionAt(issue.start), doc.positionAt(issue.end));
            const diag = new vscode.Diagnostic(
                range,
                issue.message,
                issue.status === 'removed'
                    ? vscode.DiagnosticSeverity.Warning
                    : vscode.DiagnosticSeverity.Hint
            );
            diag.source = MIGRATION_SOURCE;
            diag.code = MIGRATION_CODE;
            if (issue.status === 'deprecated') {
                diag.tags = [vscode.DiagnosticTag.Deprecated];
            }
            return diag;
        });
        this.collection.set(doc.uri, diags);
    }

    dispose(): void {
        for (const t of this.timers.values()) {
            clearTimeout(t);
        }
        this.timers.clear();
        this.collection.dispose();
        for (const s of this.subs) {
            s.dispose();
        }
    }
}
