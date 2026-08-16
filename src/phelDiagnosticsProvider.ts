import { execFile } from 'node:child_process';
import * as vscode from 'vscode';
import type { PhelDaemonDiagnostics } from './phelDaemonDiagnosticsProvider';
import {
    groupDiagnosticsByUri,
    isUnknownCommandError,
    parsePhelAnalyzeOutput,
    toZeroBasedRange,
    PhelDiagnostic,
} from './phelDiagnostics';
import { affectsPhelExecutable, resolvePhelExecutable } from './phelExecutable';
import { toInvocation } from './phelInvocation';
import { pathFromCli, pickWorkspaceFolder, uriFromCli } from './phelWorkspace';

const COLLECTION_NAME = 'phel';

type Engine = 'auto' | 'lint' | 'analyze';

/**
 * `phel lint` reports everything `phel analyze` does plus rule-based findings
 * (unused bindings, arity, the rules configured in `phel-lint.phel`), so it is
 * preferred where available. It arrived after `analyze`, so `auto` falls back
 * the first time a CLI rejects the subcommand and remembers that per session.
 */
let lintUnavailable = false;

/**
 * What the last run reported per document, keyed by uri. The live (on-type)
 * pass reads it to drop the findings this one already shows.
 */
const saved = new Map<string, PhelDiagnostic[]>();

/** The on-save findings for `uri`, as the live pass needs them for deduping. */
export function savedPhelDiagnostics(uri: vscode.Uri): readonly PhelDiagnostic[] {
    return saved.get(uri.toString()) ?? [];
}

/**
 * Runs `phel lint` (or `phel analyze`) on every `.phel` open / save and
 * surfaces the results as VS Code diagnostics.
 *
 * `live` is the on-type provider, when it is registered. Beyond deduping, it
 * owns the analysis daemon, so the `analyze` engine goes through that instead
 * of spawning a CLI per save.
 *
 * Configuration:
 *   - `phel.diagnostics.enabled` (default `true`)
 *   - `phel.diagnostics.engine` (`auto` | `lint` | `analyze`, default `auto`)
 *   - `phel.diagnostics.command` (overrides `phel.executablePath`; default
 *     `vendor/bin/phel`, resolved relative to the workspace folder when
 *     not absolute)
 */
export function registerDiagnostics(
    context: vscode.ExtensionContext,
    live?: PhelDaemonDiagnostics
): void {
    const collection = vscode.languages.createDiagnosticCollection(COLLECTION_NAME);
    context.subscriptions.push(collection);

    const setDiagnostics = (uri: vscode.Uri, diagnostics: PhelDiagnostic[]) => {
        saved.set(uri.toString(), diagnostics);
        collection.set(uri, toVscodeDiagnostics(diagnostics));
        live?.syncSaved(uri);
    };
    const clearDiagnostics = (uri: vscode.Uri) => {
        saved.delete(uri.toString());
        collection.delete(uri);
        live?.syncSaved(uri);
    };

    type State = { running: boolean; pending: vscode.TextDocument | null };
    const states = new Map<string, State>();

    const isOpen = (uri: vscode.Uri) =>
        vscode.workspace.textDocuments.some((d) => d.uri.toString() === uri.toString());

    const runForDocument = (document: vscode.TextDocument) => {
        if (document.languageId !== 'phel') {
            return;
        }
        if (document.uri.scheme !== 'file') {
            return;
        }
        if (!isEnabled()) {
            clearDiagnostics(document.uri);
            return;
        }
        const key = document.uri.toString();
        const state = states.get(key) ?? { running: false, pending: null };
        if (state.running) {
            state.pending = document;
            states.set(key, state);
            return;
        }
        state.running = true;
        states.set(key, state);

        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        const command = resolvePhelExecutable('diagnostics.command', folder);
        const cwd = folder?.uri.fsPath;
        checkFile(document, command, cwd, live)
            .then((diagnostics) => {
                if (!isOpen(document.uri)) {
                    clearDiagnostics(document.uri);
                    return;
                }
                // `phel lint` may report on files the linted one requires, so
                // only the entries for this document belong to it — and it
                // names each of them by its resolved path, which is not how
                // the editor spells one under a symlinked folder.
                const byUri = groupDiagnosticsByUri(
                    withWorkspacePaths(diagnostics, folder),
                    document.uri.fsPath
                );
                setDiagnostics(document.uri, byUri.get(document.uri.fsPath) ?? []);
            })
            .catch((err) => {
                console.error(`phel diagnostics failed for ${document.uri.fsPath}:`, err);
                clearDiagnostics(document.uri);
            })
            .finally(() => {
                const next = states.get(key);
                if (!next) {
                    return;
                }
                const queued = next.pending;
                states.delete(key);
                if (queued && isOpen(queued.uri)) {
                    runForDocument(queued);
                }
            });
    };

    // `phel lint` walks the configured source dirs, so one run can populate
    // diagnostics for files that were never opened.
    const lintWorkspace = async () => {
        const folder = await pickWorkspaceFolder('Phel: open a folder to lint a workspace.');
        if (!folder) {
            return;
        }
        const command = resolvePhelExecutable('diagnostics.command', folder);
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: 'Phel: linting workspace…' },
            async () => {
                try {
                    const diagnostics = await runPhel(
                        command,
                        ['lint', '--format=json'],
                        folder.uri.fsPath
                    );
                    clearAllDiagnostics(collection, live);
                    let files = 0;
                    for (const [fsPath, forFile] of groupDiagnosticsByUri(diagnostics)) {
                        setDiagnostics(uriFromCli(fsPath, folder), forFile);
                        files++;
                    }
                    void vscode.window.showInformationMessage(
                        diagnostics.length === 0
                            ? 'Phel lint: no issues found.'
                            : `Phel lint: ${diagnostics.length} issue(s) in ${files} file(s).`
                    );
                } catch (err) {
                    const detail = err instanceof Error ? err.message : String(err);
                    void vscode.window.showErrorMessage(`Phel lint failed: ${detail}`);
                }
            }
        );
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('phel.lintWorkspace', lintWorkspace),
        vscode.workspace.onDidOpenTextDocument(runForDocument),
        vscode.workspace.onDidSaveTextDocument((doc) => {
            // Before the run, not after: the daemon holds whatever it
            // evaluated for the previous contents of this file.
            live?.markSaved(doc);
            runForDocument(doc);
        }),
        vscode.workspace.onDidCloseTextDocument((doc) => clearDiagnostics(doc.uri)),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (
                e.affectsConfiguration('phel.diagnostics.enabled') ||
                e.affectsConfiguration('phel.diagnostics.engine') ||
                affectsPhelExecutable(e)
            ) {
                // A different executable may well have `lint`.
                lintUnavailable = false;
                clearAllDiagnostics(collection, live);
                vscode.workspace.textDocuments.forEach(runForDocument);
            }
        })
    );

    vscode.workspace.textDocuments.forEach(runForDocument);
}

function isEnabled(): boolean {
    return vscode.workspace.getConfiguration('phel').get<boolean>('diagnostics.enabled', true);
}

function configuredEngine(): Engine {
    return vscode.workspace.getConfiguration('phel').get<Engine>('diagnostics.engine', 'auto');
}

function clearAllDiagnostics(
    collection: vscode.DiagnosticCollection,
    live: PhelDaemonDiagnostics | undefined
): void {
    const cleared = [...saved.keys()];
    saved.clear();
    collection.clear();
    for (const key of cleared) {
        live?.syncSaved(vscode.Uri.parse(key));
    }
}

/** Run the configured engine over one document, falling back when `lint` is missing. */
async function checkFile(
    document: vscode.TextDocument,
    command: string,
    cwd: string | undefined,
    live: PhelDaemonDiagnostics | undefined
): Promise<PhelDiagnostic[]> {
    const engine = configuredEngine();
    const targetPath = document.uri.fsPath;
    // `analyze` is exactly what the daemon's `analyzeSource` answers, so where
    // it is the engine the warm process replaces a PHP boot per save.
    const analyze = async () =>
        (await live?.analyzeSaved(document)) ?? runPhel(command, ['analyze', targetPath], cwd);

    if (engine === 'analyze') {
        return analyze();
    }
    if (engine === 'lint') {
        return runPhel(command, ['lint', '--format=json', targetPath], cwd);
    }

    if (lintUnavailable) {
        return analyze();
    }
    try {
        return await runPhel(command, ['lint', '--format=json', targetPath], cwd);
    } catch (err) {
        if (!(err instanceof UnknownCommandError)) {
            throw err;
        }
        lintUnavailable = true;
        return analyze();
    }
}

/** Thrown when the CLI does not know the subcommand, so a fallback can retry. */
class UnknownCommandError extends Error {}

function runPhel(
    command: string,
    args: string[],
    cwd: string | undefined
): Promise<PhelDiagnostic[]> {
    return new Promise((resolve, reject) => {
        const inv = toInvocation(command, args);
        const opts = { maxBuffer: 8 * 1024 * 1024, cwd, shell: inv.shell };
        execFile(inv.file, inv.args, opts, (err, stdout, stderr) => {
            // A non-zero exit is normal: both subcommands exit 1 when they
            // found errors, and still print the diagnostics on stdout.
            if (err && !stdout) {
                if (isUnknownCommandError(stderr)) {
                    reject(new UnknownCommandError(stderr.trim()));
                    return;
                }
                reject(new Error(stderr || err.message));
                return;
            }
            resolve(parsePhelAnalyzeOutput(stdout));
        });
    });
}

/**
 * The same findings with every path `phel lint` printed spelled the way the
 * editor spells it, so grouping them by uri can hit an open document.
 */
function withWorkspacePaths(
    diagnostics: readonly PhelDiagnostic[],
    folder: vscode.WorkspaceFolder | undefined
): PhelDiagnostic[] {
    return diagnostics.map((diag) =>
        diag.uri ? { ...diag, uri: pathFromCli(diag.uri, folder) } : diag
    );
}

/** Map phel diagnostics onto the editor's, shared with the live provider. */
export function toVscodeDiagnostics(diagnostics: readonly PhelDiagnostic[]): vscode.Diagnostic[] {
    return diagnostics.map((diag) => {
        const r = toZeroBasedRange(diag);
        const range = new vscode.Range(
            new vscode.Position(r.startLine, r.startCol),
            new vscode.Position(r.endLine, r.endCol)
        );
        const item = new vscode.Diagnostic(range, diag.message, mapSeverity(diag.severity));
        if (diag.code) {
            item.code = diag.code;
        }
        item.source = COLLECTION_NAME;
        return item;
    });
}

function mapSeverity(severity: PhelDiagnostic['severity']): vscode.DiagnosticSeverity {
    switch (severity) {
        case 'error':
            return vscode.DiagnosticSeverity.Error;
        case 'warning':
            return vscode.DiagnosticSeverity.Warning;
        case 'info':
            return vscode.DiagnosticSeverity.Information;
        case 'hint':
            return vscode.DiagnosticSeverity.Hint;
    }
}
