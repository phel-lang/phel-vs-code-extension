import { execFile } from 'node:child_process';
import * as vscode from 'vscode';
import { parsePhelAnalyzeOutput, toZeroBasedRange, PhelDiagnostic } from './phelDiagnostics';
import { affectsPhelExecutable, resolvePhelExecutable } from './phelExecutable';

const COLLECTION_NAME = 'phel';

/**
 * Runs `phel analyze <file>` on every `.phel` open / save and surfaces the
 * results as VS Code diagnostics.
 *
 * Configuration:
 *   - `phel.diagnostics.enabled` (default `true`)
 *   - `phel.diagnostics.command` (overrides `phel.executablePath`; default
 *     `vendor/bin/phel`, resolved relative to the workspace folder when
 *     not absolute)
 */
export function registerDiagnostics(context: vscode.ExtensionContext): void {
    const collection = vscode.languages.createDiagnosticCollection(COLLECTION_NAME);
    context.subscriptions.push(collection);

    const inFlight = new Map<string, Promise<void>>();

    const runForDocument = (document: vscode.TextDocument) => {
        if (document.languageId !== 'phel') {
            return;
        }
        if (!isEnabled()) {
            collection.delete(document.uri);
            return;
        }
        const key = document.uri.toString();
        if (inFlight.has(key)) {
            return;
        }
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        const command = resolvePhelExecutable('diagnostics.command', folder);
        const cwd = folder?.uri.fsPath;
        const run = analyzeFile(command, document.uri.fsPath, cwd)
            .then((diagnostics) => {
                collection.set(document.uri, toVscodeDiagnostics(diagnostics));
            })
            .catch((err) => {
                console.error(`phel analyze failed for ${document.uri.fsPath}:`, err);
                collection.delete(document.uri);
            })
            .finally(() => {
                inFlight.delete(key);
            });
        inFlight.set(key, run);
    };

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(runForDocument),
        vscode.workspace.onDidSaveTextDocument(runForDocument),
        vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('phel.diagnostics.enabled') || affectsPhelExecutable(e)) {
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

function analyzeFile(
    command: string,
    filePath: string,
    cwd: string | undefined
): Promise<PhelDiagnostic[]> {
    return new Promise((resolve, reject) => {
        execFile(
            command,
            ['analyze', filePath],
            { maxBuffer: 8 * 1024 * 1024, cwd },
            (err, stdout, stderr) => {
                if (err && !stdout) {
                    reject(new Error(stderr || err.message));
                    return;
                }
                resolve(parsePhelAnalyzeOutput(stdout));
            }
        );
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
