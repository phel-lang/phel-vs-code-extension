// Project health commands backed by the Phel CLI.
//
//   phel.doctor      — run `phel doctor` (PHP extensions, module health,
//                      config, OPcache) and stream it to an output channel.
//   phel.showConfig  — run `phel config --format=json` and open the effective
//                      configuration as a pretty-printed JSON document.

import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { resolvePhelExecutable } from './phelExecutable';

const OUTPUT_CHANNEL_NAME = 'Phel Doctor';

let output: vscode.OutputChannel | undefined;

function channel(): vscode.OutputChannel {
    output ??= vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    return output;
}

function activeFolder(): vscode.WorkspaceFolder | undefined {
    const doc = vscode.window.activeTextEditor?.document;
    if (doc && doc.uri.scheme === 'file') {
        const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
        if (folder) {
            return folder;
        }
    }
    return vscode.workspace.workspaceFolders?.[0];
}

interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
}

function runPhel(
    args: string[],
    folder: vscode.WorkspaceFolder,
    onStdout?: (chunk: string) => void
): Promise<RunResult> {
    return new Promise((resolve) => {
        // doctor/config follow the same executable precedence as diagnostics.
        const command = resolvePhelExecutable('diagnostics.command', folder);
        const proc = spawn(command, args, { cwd: folder.uri.fsPath });
        let stdout = '';
        let stderr = '';
        proc.stdout?.on('data', (d) => {
            const text = d.toString();
            stdout += text;
            onStdout?.(text);
        });
        proc.stderr?.on('data', (d) => {
            stderr += d.toString();
        });
        proc.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
        proc.on('error', (err) => resolve({ code: 1, stdout, stderr: err.message }));
    });
}

async function runDoctor(): Promise<void> {
    const folder = activeFolder();
    if (!folder) {
        vscode.window.showWarningMessage('Open a Phel project folder first.');
        return;
    }
    const ch = channel();
    ch.clear();
    ch.show(true);
    ch.appendLine(`$ phel doctor  (${folder.uri.fsPath})`);
    ch.appendLine('');

    const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Running phel doctor…' },
        () => runPhel(['doctor'], folder, (chunk) => ch.append(chunk))
    );
    if (result.stderr.trim()) {
        ch.appendLine('');
        ch.appendLine(result.stderr.trim());
    }
    ch.appendLine('');
    ch.appendLine(`phel doctor exited with code ${result.code}.`);
    if (result.code === 0) {
        vscode.window.showInformationMessage('Phel doctor: your system meets all requirements.');
    } else {
        vscode.window.showWarningMessage(
            'Phel doctor reported problems. See the "Phel Doctor" output for details.'
        );
    }
}

async function showConfig(): Promise<void> {
    const folder = activeFolder();
    if (!folder) {
        vscode.window.showWarningMessage('Open a Phel project folder first.');
        return;
    }
    const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Reading phel config…' },
        () => runPhel(['config', '--format=json'], folder)
    );

    if (result.code !== 0 && !result.stdout.trim()) {
        channel().clear();
        channel().appendLine(`$ phel config --format=json  (${folder.uri.fsPath})`);
        channel().appendLine('');
        channel().appendLine(
            result.stderr.trim() || `phel config exited with code ${result.code}.`
        );
        channel().show(true);
        vscode.window.showWarningMessage(
            'Could not read Phel config. See the "Phel Doctor" output for details.'
        );
        return;
    }

    const pretty = prettyJson(result.stdout) ?? result.stdout;
    const doc = await vscode.workspace.openTextDocument({
        content: pretty,
        language: 'json',
    });
    await vscode.window.showTextDocument(doc, { preview: true });
}

function prettyJson(raw: string): string | null {
    try {
        return JSON.stringify(JSON.parse(raw), null, 2) + '\n';
    } catch {
        // Output wasn't pure JSON (older Phel, or a warning was prepended).
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.stringify(JSON.parse(raw.slice(start, end + 1)), null, 2) + '\n';
            } catch {
                return null;
            }
        }
        return null;
    }
}

export function registerDoctorCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('phel.doctor', runDoctor),
        vscode.commands.registerCommand('phel.showConfig', showConfig)
    );
}
