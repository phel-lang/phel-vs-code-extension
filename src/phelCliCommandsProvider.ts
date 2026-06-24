// Thin wrappers around long-running / interactive Phel CLI commands:
//
//   phel.test.watch  — `phel test --watch` in a terminal
//   phel.build       — `phel build` with an optimization-level / report prompt
//   phel.init        — `phel init <name> --template=<t>` with template picker
//
// These run in an integrated terminal (they are long-running or scaffold files
// the user wants to see), matching the existing terminal-based test commands.

import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { resolvePhelExecutable } from './phelExecutable';
import {
    buildArgs,
    type OptimizationLevel,
    parseTemplates,
    type PhelTemplate,
} from './phelCliCommands';

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

function quote(arg: string): string {
    return /[\s"'$`\\]/.test(arg) ? `'${arg.replace(/'/g, "'\\''")}'` : arg;
}

function runInTerminal(name: string, command: string, args: string[], cwd: string): void {
    const terminal = vscode.window.createTerminal({ name, cwd });
    terminal.show(true);
    terminal.sendText([command, ...args].map(quote).join(' '));
}

function testWatch(): void {
    const folder = activeFolder();
    if (!folder) {
        vscode.window.showWarningMessage('Open a Phel project folder first.');
        return;
    }
    const command = resolvePhelExecutable('test.command', folder);
    runInTerminal('Phel Test (watch)', command, ['test', '--watch'], folder.uri.fsPath);
}

async function build(): Promise<void> {
    const folder = activeFolder();
    if (!folder) {
        vscode.window.showWarningMessage('Open a Phel project folder first.');
        return;
    }
    const level = await vscode.window.showQuickPick(
        [
            {
                label: 'Default',
                description: 'Use the level from phel-config.php',
                value: undefined,
            },
            { label: '-O0', description: 'Optimization off', value: '0' as OptimizationLevel },
            {
                label: '-O2',
                description: 'Inline + tail-call rewrite',
                value: '2' as OptimizationLevel,
            },
        ],
        { placeHolder: 'Optimization level for phel build' }
    );
    if (level === undefined) {
        return; // cancelled
    }
    const report = await vscode.window.showQuickPick(
        [
            { label: 'No report', value: false },
            { label: 'Print build report', value: true },
        ],
        { placeHolder: 'Print a build report (namespace count, sizes, time)?' }
    );
    if (report === undefined) {
        return; // cancelled
    }
    const command = resolvePhelExecutable('diagnostics.command', folder);
    const args = buildArgs({ optimizationLevel: level.value, report: report.value });
    runInTerminal('Phel Build', command, args, folder.uri.fsPath);
}

function listTemplates(command: string, cwd: string): Promise<PhelTemplate[]> {
    return new Promise((resolve) => {
        const proc = spawn(command, ['init', '--list-templates'], { cwd });
        let output = '';
        proc.stdout?.on('data', (d) => (output += d.toString()));
        proc.stderr?.on('data', (d) => (output += d.toString()));
        proc.on('close', () => resolve(parseTemplates(output)));
        proc.on('error', () => resolve([]));
    });
}

async function init(): Promise<void> {
    const folder = activeFolder();
    const cwd = folder?.uri.fsPath ?? process.cwd();
    const command = resolvePhelExecutable('diagnostics.command', folder);

    const templates = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Loading Phel templates…' },
        () => listTemplates(command, cwd)
    );

    const items: (vscode.QuickPickItem & { template?: string })[] = [
        { label: 'Default project', description: 'phel init (no template)' },
        ...templates.map((t) => ({ label: t.name, description: t.description, template: t.name })),
    ];
    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Project template',
    });
    if (!picked) {
        return;
    }

    const projectName = await vscode.window.showInputBox({
        prompt: 'Project name (creates a subdirectory; leave empty for the default "app")',
        validateInput: (value) =>
            value && !/^[A-Za-z0-9._-]+$/.test(value)
                ? 'Use letters, numbers, dots, dashes or underscores.'
                : undefined,
    });
    if (projectName === undefined) {
        return; // cancelled
    }

    const args = ['init'];
    if (projectName.trim()) {
        args.push(projectName.trim());
    }
    if (picked.template) {
        args.push(`--template=${picked.template}`);
    }
    runInTerminal('Phel Init', command, args, cwd);
}

export function registerCliCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('phel.test.watch', testWatch),
        vscode.commands.registerCommand('phel.build', build),
        vscode.commands.registerCommand('phel.init', init)
    );
}
