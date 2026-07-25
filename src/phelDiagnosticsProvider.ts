import { execFile } from 'node:child_process';
import * as vscode from 'vscode';
import {
    groupDiagnosticsByUri,
    isUnknownCommandError,
    parsePhelAnalyzeOutput,
    toZeroBasedRange,
    PhelDiagnostic,
} from './phelDiagnostics';
import { affectsPhelExecutable, resolvePhelExecutable } from './phelExecutable';

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
 * Runs `phel lint` (or `phel analyze`) on every `.phel` open / save and
 * surfaces the results as VS Code diagnostics.
 *
 * Configuration:
 *   - `phel.diagnostics.enabled` (default `true`)
 *   - `phel.diagnostics.engine` (`auto` | `lint` | `analyze`, default `auto`)
 *   - `phel.diagnostics.command` (overrides `phel.executablePath`; default
 *     `vendor/bin/phel`, resolved relative to the workspace folder when
 *     not absolute)
 */
export function registerDiagnostics(context: vscode.ExtensionContext): void {
    const collection = vscode.languages.createDiagnosticCollection(COLLECTION_NAME);
    context.subscriptions.push(collection);

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
            collection.delete(document.uri);
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
        checkFile(command, document.uri.fsPath, cwd)
            .then((diagnostics) => {
                if (!isOpen(document.uri)) {
                    collection.delete(document.uri);
                    return;
                }
                // `phel lint` may report on files the linted one requires, so
                // only the entries for this document belong to it.
                const byUri = groupDiagnosticsByUri(diagnostics, document.uri.fsPath);
                collection.set(
                    document.uri,
                    toVscodeDiagnostics(byUri.get(document.uri.fsPath) ?? [])
                );
            })
            .catch((err) => {
                console.error(`phel diagnostics failed for ${document.uri.fsPath}:`, err);
                collection.delete(document.uri);
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
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            void vscode.window.showWarningMessage('Phel: open a folder to lint a workspace.');
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
                    collection.clear();
                    let files = 0;
                    for (const [fsPath, forFile] of groupDiagnosticsByUri(diagnostics)) {
                        collection.set(vscode.Uri.file(fsPath), toVscodeDiagnostics(forFile));
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
        vscode.workspace.onDidSaveTextDocument(runForDocument),
        vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (
                e.affectsConfiguration('phel.diagnostics.enabled') ||
                e.affectsConfiguration('phel.diagnostics.engine') ||
                affectsPhelExecutable(e)
            ) {
                // A different executable may well have `lint`.
                lintUnavailable = false;
                collection.clear();
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

/** Run the configured engine over one path, falling back when `lint` is missing. */
async function checkFile(
    command: string,
    targetPath: string,
    cwd: string | undefined
): Promise<PhelDiagnostic[]> {
    const engine = configuredEngine();
    if (engine === 'analyze') {
        return runPhel(command, ['analyze', targetPath], cwd);
    }
    if (engine === 'lint') {
        return runPhel(command, ['lint', '--format=json', targetPath], cwd);
    }

    if (lintUnavailable) {
        return runPhel(command, ['analyze', targetPath], cwd);
    }
    try {
        return await runPhel(command, ['lint', '--format=json', targetPath], cwd);
    } catch (err) {
        if (!(err instanceof UnknownCommandError)) {
            throw err;
        }
        lintUnavailable = true;
        return runPhel(command, ['analyze', targetPath], cwd);
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
        execFile(command, args, { maxBuffer: 8 * 1024 * 1024, cwd }, (err, stdout, stderr) => {
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

function toVscodeDiagnostics(diagnostics: PhelDiagnostic[]): vscode.Diagnostic[] {
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
