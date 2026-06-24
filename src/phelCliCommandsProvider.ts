// Thin wrappers around long-running / interactive Phel CLI commands:
//
//   phel.test.watch  — `phel test --watch` in a terminal
//   phel.build       — `phel build` with an optimization-level / report prompt
//   phel.init        — `phel init <name> --template=<t>` with template picker
//
// These run in an integrated terminal (they are long-running or scaffold files
// the user wants to see), matching the existing terminal-based test commands.

import * as vscode from 'vscode';
import { resolvePhelExecutable } from './phelExecutable';
import { runPhelCli } from './phelCli';
import { runInTerminal } from './phelTerminal';
import { activeWorkspaceFolder } from './phelWorkspace';
import {
    buildArgs,
    type OptimizationLevel,
    parseTemplates,
    type PhelTemplate,
} from './phelCliCommands';

function testWatch(): void {
    const folder = activeWorkspaceFolder();
    if (!folder) {
        vscode.window.showWarningMessage('Open a Phel project folder first.');
        return;
    }
    const command = resolvePhelExecutable('test.command', folder);
    runInTerminal('Phel Test (watch)', command, ['test', '--watch'], folder.uri.fsPath);
}

async function build(): Promise<void> {
    const folder = activeWorkspaceFolder();
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
    // build has no per-command override; resolve from phel.executablePath.
    const command = resolvePhelExecutable(undefined, folder);
    const args = buildArgs({ optimizationLevel: level.value, report: report.value });
    runInTerminal('Phel Build', command, args, folder.uri.fsPath);
}

async function listTemplates(command: string, cwd: string): Promise<PhelTemplate[]> {
    const result = await runPhelCli(command, ['init', '--list-templates'], cwd);
    return parseTemplates(result.stdout + result.stderr);
}

async function init(): Promise<void> {
    const folder = activeWorkspaceFolder();
    const cwd = folder?.uri.fsPath ?? process.cwd();
    // init has no per-command override; resolve from phel.executablePath.
    const command = resolvePhelExecutable(undefined, folder);

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
