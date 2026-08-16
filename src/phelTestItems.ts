// The TestItem tree behind both Explorer controllers.
//
// `phel-tests` and `phel-benchmarks` differ in what they scan a file for
// (`deftest` vs `defbench`) and in how they run what they find. Everything in
// between — which files to look at, turning each into a file item with one
// child per declaration, keeping that in step with the filesystem and with
// `test-dirs`, and folding a run request back into per-file work — is the same
// job twice, so it lives here rather than in each controller.

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import type { PhelProjectConfigProvider } from './phelProjectConfigProvider';
import type { PhelTestRef } from './phelTestScanner';

/**
 * Never look inside dependencies: `vendor` is full of `.phel` files whose
 * `deftest`s and `defbench`es belong to somebody else's suite, and running one
 * from here says nothing about this project.
 */
const NEVER_SCANNED = '**/{node_modules,vendor}/**';

/** How long a burst of file creations is allowed to coalesce into one rescan. */
const RELOAD_DEBOUNCE_MS = 300;

/** Pulls the declarations one controller cares about out of a source file. */
export type PhelDeclScanner = (source: string) => PhelTestRef[];

async function readFile(uri: vscode.Uri): Promise<string | null> {
    try {
        return await fs.readFile(uri.fsPath, 'utf-8');
    } catch {
        return null;
    }
}

/**
 * Every `.phel` file that could hold a declaration. `test-dirs` from the
 * project's configuration is the authoritative answer; without it (no CLI, or
 * one too old to print its config) fall back to the whole folder minus the
 * dependencies.
 */
async function findCandidateFiles(
    projectConfig?: PhelProjectConfigProvider
): Promise<vscode.Uri[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!projectConfig || folders.length === 0) {
        return vscode.workspace.findFiles('**/*.phel', NEVER_SCANNED);
    }
    const perFolder = await Promise.all(
        folders.map(async (folder) => {
            const dirs = await projectConfig.testDirs(folder);
            const pattern = new vscode.RelativePattern(folder, candidateGlob(dirs));
            return vscode.workspace.findFiles(pattern, NEVER_SCANNED);
        })
    );
    return perFolder.flat();
}

function candidateGlob(testDirs: readonly string[]): string {
    const dirs = testDirs.map((dir) => dir.replace(/^\.\//, '').replace(/\/+$/, ''));
    if (dirs.length === 0) {
        return '**/*.phel';
    }
    return dirs.length === 1 ? `${dirs[0]}/**/*.phel` : `{${dirs.join(',')}}/**/*.phel`;
}

/**
 * Owns one controller's items: discovers them, and keeps them in step with the
 * filesystem and with the project configuration.
 */
export class PhelTestItemTree implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    /** Coalesces the reloads a bulk file change (a branch switch) would trigger. */
    private reloadTimer?: NodeJS.Timeout;
    /** Set once the Explorer has asked for the tree; nothing to keep in step before. */
    private loaded = false;

    constructor(
        private readonly controller: vscode.TestController,
        private readonly scan: PhelDeclScanner,
        private readonly projectConfig?: PhelProjectConfigProvider
    ) {
        this.controller.resolveHandler = async () => {
            this.loaded = true;
            await this.reload();
        };
        // A save updates the file it edited; creating or deleting a `.phel`
        // file elsewhere (git checkout, a new test file, rm) has no document to
        // hang off, so the tree follows the filesystem instead.
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.phel');
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument((doc) => {
                if (doc.languageId !== 'phel') {
                    return;
                }
                this.attach(doc.uri, doc.getText());
            }),
            watcher,
            watcher.onDidCreate(() => this.scheduleReload()),
            watcher.onDidDelete((uri) => this.controller.items.delete(uri.toString()))
        );
        if (this.projectConfig) {
            // `test-dirs` decides what is scanned at all.
            this.disposables.push(this.projectConfig.onDidChange(() => this.scheduleReload()));
        }
    }

    /** The file items currently in the tree, for a run request without an include. */
    roots(): vscode.TestItem[] {
        const items: vscode.TestItem[] = [];
        this.controller.items.forEach((item) => items.push(item));
        return items;
    }

    /** The file item for `uri`, when the tree holds one. */
    itemFor(uri: vscode.Uri): vscode.TestItem | undefined {
        return this.controller.items.get(uri.toString());
    }

    /**
     * Build the tree if nothing asked for it yet. The Explorer's own
     * `resolveHandler` is the usual trigger, but running tests on save has to
     * work in a window where the Testing view was never opened.
     */
    async ensureLoaded(): Promise<void> {
        if (this.loaded) {
            return;
        }
        this.loaded = true;
        await this.reload();
    }

    /** Rescan the workspace and replace the tree with what is there now. */
    async reload(): Promise<void> {
        const uris = await findCandidateFiles(this.projectConfig);
        // Read files concurrently; attach serially afterwards (`attach` mutates
        // the controller and is cheap/synchronous).
        const read = await Promise.all(
            uris.map(async (uri) => ({ uri, text: await readFile(uri) }))
        );
        const found = new Set<string>();
        for (const { uri, text } of read) {
            if (text !== null && this.attach(uri, text)) {
                found.add(uri.toString());
            }
        }
        // A reload is also how a file that was deleted, or that left the
        // configured test directories, disappears from the tree.
        const stale = this.roots()
            .map((item) => item.id)
            .filter((id) => !found.has(id));
        for (const id of stale) {
            this.controller.items.delete(id);
        }
    }

    dispose(): void {
        if (this.reloadTimer) {
            clearTimeout(this.reloadTimer);
        }
        for (const d of this.disposables) {
            d.dispose();
        }
    }

    /** One file item with a child per declaration, or nothing when it has none. */
    private attach(file: vscode.Uri, text: string): vscode.TestItem | null {
        const decls = this.scan(text);
        if (decls.length === 0) {
            this.controller.items.delete(file.toString());
            return null;
        }
        const fileItem =
            this.controller.items.get(file.toString()) ??
            this.controller.createTestItem(file.toString(), path.basename(file.fsPath), file);
        fileItem.children.replace(
            decls.map((d) => {
                const item = this.controller.createTestItem(
                    `${file.toString()}::${d.name}`,
                    d.name,
                    file
                );
                item.range = new vscode.Range(d.line, d.nameCol, d.line, d.nameCol + d.name.length);
                return item;
            })
        );
        this.controller.items.add(fileItem);
        return fileItem;
    }

    /** Rescan soon, once, however many files changed. */
    private scheduleReload(): void {
        if (!this.loaded) {
            // The tree was never built, so there is nothing to bring up to date
            // — and scanning the workspace for a view nobody opened is not free.
            return;
        }
        if (this.reloadTimer) {
            clearTimeout(this.reloadTimer);
        }
        this.reloadTimer = setTimeout(() => {
            this.reloadTimer = undefined;
            void this.reload();
        }, RELOAD_DEBOUNCE_MS);
    }
}

/** File item → the leaf items requested under it, excludes already applied. */
export function groupQueue(
    queue: readonly vscode.TestItem[],
    request: vscode.TestRunRequest
): Map<vscode.TestItem, vscode.TestItem[]> {
    const byFile = new Map<vscode.TestItem, vscode.TestItem[]>();
    const addLeaf = (item: vscode.TestItem): void => {
        if (request.exclude?.includes(item)) {
            return;
        }
        // A leaf item has an id of the form "<fileUri>::<name>".
        const isLeaf = item.id.includes('::');
        const fileItem = isLeaf ? item.parent : item;
        if (!fileItem) {
            return;
        }
        const leaves = byFile.get(fileItem) ?? [];
        if (isLeaf) {
            leaves.push(item);
        } else {
            item.children.forEach((child) => {
                if (!request.exclude?.includes(child)) {
                    leaves.push(child);
                }
            });
        }
        byFile.set(fileItem, leaves);
    };
    for (const item of queue) {
        addLeaf(item);
    }
    return byFile;
}

/** The declared name behind a leaf item, which its id carries after `::`. */
export function nameForLeaf(item: vscode.TestItem): string {
    const sep = item.id.indexOf('::');
    return sep < 0 ? item.label : item.id.slice(sep + 2);
}
