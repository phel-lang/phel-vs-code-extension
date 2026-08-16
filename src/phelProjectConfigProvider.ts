// One `phel config --format=json` per workspace folder, read lazily and cached.
//
// Reading `phel-config.php` ourselves would mean reimplementing PHP; asking the
// CLI costs a PHP boot (~300 ms), which is why nothing here runs on the
// activation path. The first feature that needs an answer pays for it, every
// later reader gets the cached one, and a missing or too-old CLI answers `null`
// — the shape every consumer already handles by keeping its previous behaviour.
//
// Invalidated when a `phel-config.php` / `phel-config-local.php` is written, or
// when the setting that decides *which* CLI answers changes.

import * as vscode from 'vscode';
import { runPhelCli } from './phelCli';
import { affectsPhelExecutable, resolvePhelExecutable } from './phelExecutable';
import {
    type PhelProjectConfig,
    ProjectConfigCache,
    parsePhelConfigJson,
} from './phelProjectConfig';

/** The config file and the local override Phel merges over it. */
const CONFIG_GLOB = '**/phel-config{.php,-local.php}';

export class PhelProjectConfigProvider implements vscode.Disposable {
    /** The folders `get` has been asked about, by URI, so `load` can find them. */
    private readonly folders = new Map<string, vscode.WorkspaceFolder>();
    /** One config-file watcher per folder, created with the first `get`. */
    private readonly watchers = new Map<string, vscode.Disposable>();
    private readonly cache = new ProjectConfigCache<string>((key) => this.load(key));
    private readonly subs: vscode.Disposable[] = [];
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    /** Fires when a configuration was invalidated, and when one has arrived. */
    readonly onDidChange = this._onDidChange.event;

    constructor() {
        this.subs.push(
            this._onDidChange,
            new vscode.Disposable(this.cache.onDidChange(() => this._onDidChange.fire())),
            vscode.workspace.onDidChangeConfiguration((e) => {
                // A different CLI is a different effective configuration.
                if (affectsPhelExecutable(e)) {
                    this.cache.invalidateAll();
                }
            }),
            vscode.workspace.onDidChangeWorkspaceFolders((e) => {
                for (const removed of e.removed) {
                    this.drop(removed);
                }
            })
        );
    }

    /** The effective config for `folder`, or `null` when the CLI cannot say. */
    get(folder: vscode.WorkspaceFolder): Promise<PhelProjectConfig | null> {
        const key = folder.uri.toString();
        this.register(folder, key);
        return this.cache.get(key);
    }

    /** What `get` resolved to last, without spawning; `undefined` until then. */
    peek(folder: vscode.WorkspaceFolder): PhelProjectConfig | null | undefined {
        return this.cache.peek(folder.uri.toString());
    }

    /** `src-dirs` for `folder`, empty when the CLI cannot say. */
    async srcDirs(folder: vscode.WorkspaceFolder): Promise<string[]> {
        return (await this.get(folder))?.srcDirs ?? [];
    }

    /** `test-dirs` for `folder`, empty when the CLI cannot say. */
    async testDirs(folder: vscode.WorkspaceFolder): Promise<string[]> {
        return (await this.get(folder))?.testDirs ?? [];
    }

    dispose(): void {
        for (const sub of this.subs) {
            sub.dispose();
        }
        for (const watcher of this.watchers.values()) {
            watcher.dispose();
        }
        this.watchers.clear();
    }

    private register(folder: vscode.WorkspaceFolder, key: string): void {
        this.folders.set(key, folder);
        if (this.watchers.has(key)) {
            return;
        }
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(folder, CONFIG_GLOB)
        );
        const invalidate = (): void => this.cache.invalidate(key);
        // Bundle the watcher with its subscriptions, so dropping the folder
        // disposes all of them together.
        this.watchers.set(
            key,
            vscode.Disposable.from(
                watcher,
                watcher.onDidCreate(invalidate),
                watcher.onDidChange(invalidate),
                watcher.onDidDelete(invalidate)
            )
        );
    }

    private drop(folder: vscode.WorkspaceFolder): void {
        const key = folder.uri.toString();
        this.watchers.get(key)?.dispose();
        this.watchers.delete(key);
        this.folders.delete(key);
        this.cache.invalidate(key);
    }

    private async load(key: string): Promise<PhelProjectConfig | null> {
        const folder = this.folders.get(key);
        if (!folder) {
            return null;
        }
        // `config` has no per-command override; resolve from phel.executablePath.
        const command = resolvePhelExecutable(undefined, folder);
        // `runPhelCli` reports a failed spawn as an exit code, never as a
        // rejection, so a missing CLI arrives here as empty stdout — and `null`
        // means "carry on as before" to every consumer.
        const result = await runPhelCli(command, ['config', '--format=json'], folder.uri.fsPath);
        return result.stdout.trim() ? parsePhelConfigJson(result.stdout) : null;
    }
}
