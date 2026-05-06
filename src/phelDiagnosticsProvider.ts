import { execFile } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { parsePhelAnalyzeOutput, toZeroBasedRange, PhelDiagnostic } from './phelDiagnostics';

const COLLECTION_NAME = 'phel';

/**
 * Runs `phel analyze <file>` on every `.phel` open / save and surfaces the
 * results as VS Code diagnostics.
 *
 * Configuration:
 *   - `phel.diagnostics.enabled` (default `true`)
 *   - `phel.diagnostics.command` (default `vendor/bin/phel`, resolved
 *     relative to the workspace folder when not absolute)
 */
export function registerDiagnostics(context: vscode.ExtensionContext): void {
    const collection = vscode.languages.createDiagnosticCollection(COLLECTION_NAME);
    context.subscriptions.push(collection);

    const runForDocument = (document: vscode.TextDocument) => {
        if (document.languageId !== 'phel') {
            return;
        }
        if (!isEnabled()) {
            collection.delete(document.uri);
            return;
        }
        const command = resolveCommand(document.uri);
        if (!command) {
            return;
        }
        analyzeFile(command, document.uri.fsPath)
            .then((diagnostics) => {
                collection.set(document.uri, toVscodeDiagnostics(diagnostics));
            })
            .catch((err) => {
                console.error(`phel analyze failed for ${document.uri.fsPath}:`, err);
                collection.delete(document.uri);
            });
    };

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(runForDocument),
        vscode.workspace.onDidSaveTextDocument(runForDocument),
        vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (
                e.affectsConfiguration('phel.diagnostics.enabled') ||
                e.affectsConfiguration('phel.diagnostics.command')
            ) {
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

function resolveCommand(fileUri: vscode.Uri): string | null {
    const config = vscode.workspace
        .getConfiguration('phel')
        .get<string>('diagnostics.command', 'vendor/bin/phel');
    if (!config) {
        return null;
    }
    if (path.isAbsolute(config)) {
        return config;
    }
    const folder = vscode.workspace.getWorkspaceFolder(fileUri);
    return folder ? path.join(folder.uri.fsPath, config) : config;
}

function analyzeFile(command: string, filePath: string): Promise<PhelDiagnostic[]> {
    return new Promise((resolve, reject) => {
        execFile(
            command,
            ['analyze', filePath],
            { maxBuffer: 8 * 1024 * 1024 },
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
