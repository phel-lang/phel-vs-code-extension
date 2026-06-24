// Project health commands backed by the Phel CLI.
//
//   phel.doctor      — run `phel doctor` (PHP extensions, module health,
//                      config, OPcache) and stream it to an output channel.
//   phel.showConfig  — run `phel config --format=json` and open the effective
//                      configuration as a pretty-printed JSON document.

import * as vscode from 'vscode';
import { resolvePhelExecutable } from './phelExecutable';
import { runPhelCli } from './phelCli';
import { activeWorkspaceFolder } from './phelWorkspace';

const OUTPUT_CHANNEL_NAME = 'Phel Doctor';

let output: vscode.OutputChannel | undefined;

function channel(): vscode.OutputChannel {
    output ??= vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    return output;
}

function runPhel(
    args: string[],
    folder: vscode.WorkspaceFolder,
    onStdout?: (chunk: string) => void
): ReturnType<typeof runPhelCli> {
    // doctor/config have no per-command override; resolve from phel.executablePath.
    const command = resolvePhelExecutable(undefined, folder);
    return runPhelCli(command, args, folder.uri.fsPath, { onStdout });
}

async function runDoctor(): Promise<void> {
    const folder = activeWorkspaceFolder();
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
    const folder = activeWorkspaceFolder();
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
        channel(),
        vscode.commands.registerCommand('phel.doctor', runDoctor),
        vscode.commands.registerCommand('phel.showConfig', showConfig)
    );
}
