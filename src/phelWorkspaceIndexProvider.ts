// VS Code wrapper around `PhelWorkspaceIndex`. Watches every `.phel` file in
// the user's workspace folders, parses it via the same parser the docs DB
// uses, and exposes the resulting workspace symbol table to the rest of
// the extension.
//
// Listens to:
//   - workspace folder add / remove
//   - file create / change / delete (via `FileSystemWatcher`)
//   - editor save (so unsaved changes show up the moment the user saves)

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { parsePhelFile } from './phelDocs';
import { PhelWorkspaceIndex } from './phelWorkspaceIndex';

const NAMESPACE_RE = /\((?:ns|in-ns)\s+([A-Za-z][\w.-]*)/;

export class PhelWorkspaceIndexer implements vscode.Disposable {
    readonly index = new PhelWorkspaceIndex();
    /** One watcher (plus its event subscriptions) per workspace folder, by URI. */
    private readonly watchers = new Map<string, vscode.Disposable>();
    private readonly disposables: vscode.Disposable[] = [];
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    async start(): Promise<void> {
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            await this.scanFolder(folder);
        }

        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(async (e) => {
                for (const removed of e.removed) {
                    this.dropFolder(removed);
                }
                for (const added of e.added) {
                    await this.scanFolder(added);
                }
                this._onDidChange.fire();
            }),
            vscode.workspace.onDidSaveTextDocument((doc) => {
                if (doc.languageId === 'phel') {
                    this.indexFromText(doc.uri.fsPath, doc.getText());
                    this._onDidChange.fire();
                }
            })
        );
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        for (const w of this.watchers.values()) {
            w.dispose();
        }
        this.watchers.clear();
        this._onDidChange.dispose();
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
        this.watchers.get(folder.uri.toString())?.dispose();
        this.watchers.delete(folder.uri.toString());

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
