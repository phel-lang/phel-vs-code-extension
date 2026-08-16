// VS Code wrapper around `PhelWorkspaceIndex`. Watches every `.phel` file in
// the user's workspace folders, parses it via the same parser the docs DB
// uses, and exposes the resulting workspace symbol table to the rest of
// the extension.
//
// Listens to:
//   - workspace folder add / remove
//   - file create / change / delete (via `FileSystemWatcher`)
//   - editor save (so unsaved changes show up the moment the user saves)
//
// It also keeps, per folder, the *other* index: the one `phel api-daemon`
// builds with `indexProject`. That one is what go-to-definition and
// find-references reach for when they need something the parser here cannot
// know — where a namespace is declared, which namespace a name belongs to.
// Building it walks the whole project through PHP, so it is scheduled rather
// than awaited: the TypeScript index never waits for it, and a folder whose
// daemon is off or missing simply keeps the behaviour it had.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { PhelApiDaemonClient } from './phelApiDaemonClient';
import { parsePhelFile } from './phelDocs';
import { affectsPhelExecutable } from './phelExecutable';
import type { PhelIndexDefinition, PhelIndexLocation, PhelProjectIndex } from './phelProjectIndex';
import type { PhelProjectConfigProvider } from './phelProjectConfigProvider';
import { PhelWorkspaceIndex } from './phelWorkspaceIndex';

const NAMESPACE_RE = /\((?:ns|in-ns)\s+([A-Za-z][\w.-]*)/;

/**
 * Where a folder's daemon comes from. `PhelDaemonDiagnostics` owns one process
 * per workspace folder; navigation borrows it rather than starting a second.
 */
export interface PhelDaemonSource {
    daemonFor(folder: vscode.WorkspaceFolder): PhelApiDaemonClient | undefined;
}

/**
 * How long after a save the project is re-indexed. Long enough that saving a
 * handful of files in a row costs one walk of the project, and that the walk
 * lands after the on-save diagnostics have had the daemon to themselves.
 */
const REINDEX_DEBOUNCE_MS = 2000;

/** What to index when no `phel config` could say what the project holds. */
const DEFAULT_INDEXED_DIRS = ['src', 'tests'];

export class PhelWorkspaceIndexer implements vscode.Disposable {
    readonly index = new PhelWorkspaceIndex();
    /** One watcher (plus its event subscriptions) per workspace folder, by URI. */
    private readonly watchers = new Map<string, vscode.Disposable>();
    private readonly disposables: vscode.Disposable[] = [];
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;
    /** The daemon's project index per folder, once one has been built. */
    private readonly projectIndexes = new Map<string, PhelProjectIndex>();
    private readonly reindexTimers = new Map<string, NodeJS.Timeout>();

    constructor(
        private readonly projectConfig?: PhelProjectConfigProvider,
        private readonly daemons?: PhelDaemonSource
    ) {}

    async start(): Promise<void> {
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            await this.scanFolder(folder);
            this.scheduleReindex(folder);
        }

        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(async (e) => {
                for (const removed of e.removed) {
                    this.dropFolder(removed);
                }
                for (const added of e.added) {
                    await this.scanFolder(added);
                    this.scheduleReindex(added);
                }
                this._onDidChange.fire();
            }),
            vscode.workspace.onDidSaveTextDocument((doc) => {
                if (doc.languageId !== 'phel') {
                    return;
                }
                this.indexFromText(doc.uri.fsPath, doc.getText());
                this._onDidChange.fire();
                // The daemon read this file off disk; only a fresh walk of the
                // project tells it what the save changed.
                const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
                if (folder) {
                    this.scheduleReindex(folder);
                }
            }),
            vscode.workspace.onDidChangeConfiguration((e) => {
                // A different executable, or live analysis being switched on or
                // off, means a different daemon (or none) answers from here on.
                if (affectsPhelExecutable(e) || e.affectsConfiguration('phel.diagnostics.live')) {
                    this.projectIndexes.clear();
                    for (const folder of vscode.workspace.workspaceFolders ?? []) {
                        this.scheduleReindex(folder);
                    }
                }
            })
        );
    }

    /**
     * The daemon's index for the folder `uri` belongs to, or `undefined` while
     * there is none. Callers use it for the parts of navigation the TypeScript
     * index cannot answer, and fall back to it when this is absent.
     */
    projectIndexFor(uri: vscode.Uri): PhelProjectIndex | undefined {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        return folder ? this.projectIndexes.get(folder.uri.toString()) : undefined;
    }

    /** The definition `symbol` names as seen from `namespace`, via the daemon. */
    async resolveSymbol(
        uri: vscode.Uri,
        namespace: string,
        symbol: string
    ): Promise<PhelIndexDefinition | undefined> {
        const client = this.navigationClient(uri);
        if (!client) {
            return undefined;
        }
        try {
            return await client.resolveSymbol(namespace, symbol);
        } catch {
            // A daemon that died or timed out leaves navigation to the caller's
            // own index, which is where it was before this ran at all.
            return undefined;
        }
    }

    /** Every reference site the daemon holds for `namespace/symbol`. */
    async findReferences(
        uri: vscode.Uri,
        namespace: string,
        symbol: string
    ): Promise<PhelIndexLocation[]> {
        const client = this.navigationClient(uri);
        if (!client) {
            return [];
        }
        try {
            return await client.findReferences(namespace, symbol);
        } catch {
            return [];
        }
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        for (const w of this.watchers.values()) {
            w.dispose();
        }
        this.watchers.clear();
        for (const timer of this.reindexTimers.values()) {
            clearTimeout(timer);
        }
        this.reindexTimers.clear();
        this.projectIndexes.clear();
        this._onDidChange.dispose();
    }

    /**
     * The daemon to ask about `uri`, or `undefined` when navigation must not
     * touch it: no folder, nothing indexed yet, or no process running. The last
     * two matter because this sits on the keypress path — asking a daemon that
     * would have to boot PHP and walk the project first is a hang, not a
     * feature, and the answer would be empty anyway.
     */
    private navigationClient(uri: vscode.Uri): PhelApiDaemonClient | undefined {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (!folder || !this.projectIndexes.has(folder.uri.toString())) {
            return undefined;
        }
        const client = this.daemons?.daemonFor(folder);
        return client?.running ? client : undefined;
    }

    private scheduleReindex(folder: vscode.WorkspaceFolder): void {
        if (!this.daemons) {
            return;
        }
        const key = folder.uri.toString();
        const existing = this.reindexTimers.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        this.reindexTimers.set(
            key,
            setTimeout(() => {
                this.reindexTimers.delete(key);
                void this.reindex(folder);
            }, REINDEX_DEBOUNCE_MS)
        );
    }

    private async reindex(folder: vscode.WorkspaceFolder): Promise<void> {
        const key = folder.uri.toString();
        const client = this.daemons?.daemonFor(folder);
        if (!client) {
            // Live analysis off, or a Phel without `api-daemon`.
            this.projectIndexes.delete(key);
            return;
        }
        try {
            const index = await client.indexProject(await this.indexedDirs(folder));
            if (index) {
                this.projectIndexes.set(key, index);
            } else {
                this.projectIndexes.delete(key);
            }
        } catch {
            // Nothing to report: navigation keeps using the TypeScript index.
            this.projectIndexes.delete(key);
        }
    }

    /**
     * What to hand `indexProject`: the project's own `src-dirs` and
     * `test-dirs`, or the conventional layout when no CLI could say. Relative
     * paths are what the config prints, and what the daemon resolves against
     * the folder it runs in.
     */
    private async indexedDirs(folder: vscode.WorkspaceFolder): Promise<string[]> {
        const config = await this.projectConfig?.get(folder);
        const dirs = [...(config?.srcDirs ?? []), ...(config?.testDirs ?? [])];
        return dirs.length > 0 ? dirs : DEFAULT_INDEXED_DIRS;
    }

    private async scanFolder(folder: vscode.WorkspaceFolder): Promise<void> {
        const pattern = new vscode.RelativePattern(folder, '**/*.phel');
        const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
        await Promise.all(files.map((uri) => this.indexFile(uri.fsPath)));

        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        // Bundle the watcher with its event subscriptions so dropping a folder
        // disposes all of them together (no leak on workspace-folder churn).
        const subscription = vscode.Disposable.from(
            watcher,
            watcher.onDidCreate((uri) =>
                this.indexFile(uri.fsPath).then(() => this._onDidChange.fire())
            ),
            watcher.onDidChange((uri) =>
                this.indexFile(uri.fsPath).then(() => this._onDidChange.fire())
            ),
            watcher.onDidDelete((uri) => {
                this.index.removeFile(uri.fsPath);
                this._onDidChange.fire();
            })
        );
        this.watchers.get(folder.uri.toString())?.dispose();
        this.watchers.set(folder.uri.toString(), subscription);
    }

    private dropFolder(folder: vscode.WorkspaceFolder): void {
        const key = folder.uri.toString();
        this.watchers.get(key)?.dispose();
        this.watchers.delete(key);
        const timer = this.reindexTimers.get(key);
        if (timer) {
            clearTimeout(timer);
            this.reindexTimers.delete(key);
        }
        this.projectIndexes.delete(key);

        const prefix = folder.uri.fsPath + path.sep;
        for (const file of [...this.indexedFiles()]) {
            if (file.startsWith(prefix)) {
                this.index.removeFile(file);
            }
        }
    }

    private async indexFile(file: string): Promise<void> {
        try {
            const text = await fs.readFile(file, 'utf-8');
            this.indexFromText(file, text);
        } catch {
            // File became unreadable / disappeared between findFiles and readFile.
            this.index.removeFile(file);
        }
    }

    private indexFromText(file: string, text: string): void {
        const ns = detectNamespace(text) || namespaceForFile(file);
        const docs = parsePhelFile(text, ns);
        this.index.setFile(file, docs);
    }

    private *indexedFiles(): IterableIterator<string> {
        for (const doc of this.index.allDocs()) {
            yield doc.sourceFile;
        }
    }
}

function detectNamespace(text: string): string | null {
    const match = text.match(NAMESPACE_RE);
    return match ? match[1] : null;
}

/**
 * Last-resort fallback for files without a `(ns ...)` form. Uses the
 * basename as the namespace so the symbol still ends up qualified.
 */
function namespaceForFile(file: string): string {
    const base = path.basename(file, '.phel');
    return base || 'unknown';
}
