// Live (on-type) analyzer diagnostics, served by one long-lived
// `phel api-daemon` per workspace folder.
//
// The on-save pass in `phelDiagnosticsProvider` spawns a CLI per run, which is
// affordable once per save and hopeless per keystroke. The daemon keeps PHP
// and the analyzer warm, so the same findings can land while you type: a
// 500 ms debounce, one request per document, its own `phel-live` collection.
//
// Only the analyzer's own findings appear here. The daemon exposes
// `analyzeSource`, not the `phel lint` rule set (unused-binding,
// unused-require, comment-style, ...), so the on-save pass stays the engine
// for those. Where the two overlap - lint promotes the analyzer's `PHEL001` /
// `PHEL002` verbatim under its own codes - `dedupeLiveDiagnostics` keeps the
// saved copy and drops the live one, so nothing is squiggled twice.
//
// The same daemon also answers the on-save pass when the effective engine is
// `analyze`, which is what `analyzeSaved` is for.

import * as vscode from 'vscode';
import { PhelApiDaemonClient } from './phelApiDaemonClient';
import {
    dedupeLiveDiagnostics,
    groupDiagnosticsByUri,
    normaliseDiagnostics,
    type PhelDiagnostic,
} from './phelDiagnostics';
import { savedPhelDiagnostics, toVscodeDiagnostics } from './phelDiagnosticsProvider';
import { affectsPhelExecutable, resolvePhelExecutable } from './phelExecutable';

const COLLECTION_NAME = 'phel-live';
const OUTPUT_CHANNEL_NAME = 'Phel Analysis';
/** Long enough that a burst of keystrokes costs one analysis, not twenty. */
const DEBOUNCE_MS = 500;
const MAX_CHARS = 200_000;

/**
 * Owns the `phel-live` collection, the daemon clients behind it, and the
 * **Phel: Restart Analysis Daemon** command.
 */
export class PhelDaemonDiagnostics implements vscode.Disposable {
    private readonly collection = vscode.languages.createDiagnosticCollection(COLLECTION_NAME);
    private readonly output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    private readonly subs: vscode.Disposable[] = [];
    private readonly timers = new Map<string, NodeJS.Timeout>();
    /** One daemon per workspace folder, keyed by the folder uri. */
    private readonly clients = new Map<string, PhelApiDaemonClient>();
    /** Last live findings per document, before deduping against the saved ones. */
    private readonly live = new Map<string, PhelDiagnostic[]>();

    constructor() {
        this.subs.push(
            vscode.commands.registerCommand('phel.diagnostics.restartDaemon', () => this.restart()),
            vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document)),
            vscode.workspace.onDidCloseTextDocument((doc) => this.forget(doc.uri)),
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (
                    e.affectsConfiguration('phel.diagnostics.live') ||
                    e.affectsConfiguration('phel.diagnostics.enabled') ||
                    affectsPhelExecutable(e)
                ) {
                    // A different executable, or a different answer to "should
                    // this run at all", invalidates every running daemon.
                    this.restart();
                }
            })
        );
    }

    /**
     * Analyze `document` through the daemon on behalf of the on-save pass.
     * Returns `undefined` when the daemon cannot serve it - live analysis off,
     * no workspace folder, a Phel without `api-daemon`, a daemon that failed -
     * so the caller falls back to spawning `phel analyze`.
     */
    async analyzeSaved(document: vscode.TextDocument): Promise<PhelDiagnostic[] | undefined> {
        const client = this.clientFor(document);
        if (!client) {
            return undefined;
        }
        try {
            return await this.analyze(client, document);
        } catch (err) {
            this.log(`analyzeSource failed for ${document.uri.fsPath}: ${describe(err)}`);
            return undefined;
        }
    }

    /**
     * Called by the on-save pass before it runs: the daemon still holds the
     * namespaces it evaluated for the *previous* contents of this file, and
     * only a restart forgets them.
     */
    markSaved(document: vscode.TextDocument): void {
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (folder) {
            this.clients.get(folder.uri.toString())?.markDepsStale(document.uri.fsPath);
        }
    }

    /** Called once the on-save findings changed, so the live ones re-dedupe. */
    syncSaved(uri: vscode.Uri): void {
        if (this.live.has(uri.toString())) {
            this.apply(uri);
        }
    }

    dispose(): void {
        this.restart();
        this.collection.dispose();
        this.output.dispose();
        for (const sub of this.subs) {
            sub.dispose();
        }
        this.subs.length = 0;
    }

    /** Stop every daemon and drop what they reported. Backs the command. */
    private restart(): void {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
        for (const client of this.clients.values()) {
            client.dispose();
        }
        this.clients.clear();
        this.live.clear();
        this.collection.clear();
        this.log('Analysis daemon stopped; the next edit starts a fresh one.');
    }

    private schedule(document: vscode.TextDocument): void {
        if (document.languageId !== 'phel' || document.uri.scheme !== 'file') {
            return;
        }
        const key = document.uri.toString();
        const existing = this.timers.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        this.timers.set(
            key,
            setTimeout(() => {
                this.timers.delete(key);
                void this.refresh(document);
            }, DEBOUNCE_MS)
        );
    }

    private async refresh(document: vscode.TextDocument): Promise<void> {
        const client = this.clientFor(document);
        if (!client || document.getText().length > MAX_CHARS) {
            // Too large to re-analyse on every change, or nothing to analyse
            // with; either way stale squiggles have to go.
            this.forget(document.uri);
            return;
        }
        try {
            this.live.set(document.uri.toString(), await this.analyze(client, document));
            this.apply(document.uri);
        } catch (err) {
            this.log(`live analysis failed for ${document.uri.fsPath}: ${describe(err)}`);
            this.forget(document.uri);
        }
    }

    private async analyze(
        client: PhelApiDaemonClient,
        document: vscode.TextDocument
    ): Promise<PhelDiagnostic[]> {
        const result = await client.request<unknown>(
            'analyzeSource',
            { source: document.getText(), uri: document.uri.fsPath },
            // Keyed by the document, so a keystroke while a request is queued
            // replaces it rather than piling a second analysis behind it.
            { key: document.uri.toString() }
        );
        const diagnostics = Array.isArray(result) ? normaliseDiagnostics(result) : [];
        return (
            groupDiagnosticsByUri(diagnostics, document.uri.fsPath).get(document.uri.fsPath) ?? []
        );
    }

    private apply(uri: vscode.Uri): void {
        const live = this.live.get(uri.toString()) ?? [];
        this.collection.set(
            uri,
            toVscodeDiagnostics(dedupeLiveDiagnostics(live, savedPhelDiagnostics(uri)))
        );
    }

    private forget(uri: vscode.Uri): void {
        const key = uri.toString();
        const timer = this.timers.get(key);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(key);
        }
        this.live.delete(key);
        this.collection.delete(uri);
    }

    /**
     * The daemon for this document's workspace folder, started on first use.
     * `undefined` when live analysis cannot apply to the document at all.
     */
    private clientFor(document: vscode.TextDocument): PhelApiDaemonClient | undefined {
        if (!isLiveEnabled() || document.languageId !== 'phel') {
            return undefined;
        }
        // The daemon's preload stage resolves the namespace by reading the uri
        // off disk (`is_file`), so an untitled or virtual document is useless
        // to it.
        if (document.uri.scheme !== 'file') {
            return undefined;
        }
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!folder) {
            return undefined; // no project root means no phel-config.php
        }

        const key = folder.uri.toString();
        let client = this.clients.get(key);
        if (!client) {
            client = new PhelApiDaemonClient({
                command: resolvePhelExecutable('diagnostics.command', folder),
                cwd: folder.uri.fsPath,
                log: (message) => this.log(message),
            });
            this.clients.set(key, client);
        }
        return client.unavailable ? undefined : client;
    }

    private log(message: string): void {
        this.output.appendLine(message);
    }
}

function isLiveEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('phel');
    return (
        config.get<boolean>('diagnostics.enabled', true) &&
        config.get<boolean>('diagnostics.live', true)
    );
}

function describe(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
