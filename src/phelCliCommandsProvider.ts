// Thin wrappers around long-running / interactive Phel CLI commands:
//
//   phel.test.watch  — `phel test --watch` in a terminal
//   phel.build       — `phel build` with an optimization-level / report prompt
//   phel.init        — `phel init <name> --template=<t>` with template picker
//   phel.bench       — `phel bench` over the project or the current file
//   phel.runFile     — `phel run <file>` on one script
//   phel.balance     — `phel balance`, optionally with `--fix`
//
// These run in an integrated terminal (they are long-running or scaffold files
// the user wants to see), matching the existing terminal-based test commands.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { resolvePhelExecutable } from './phelExecutable';
import { runPhelCli } from './phelCli';
import { runInTerminal } from './phelTerminal';
import { activeWorkspaceFolder } from './phelWorkspace';
import {
    balanceArgs,
    benchArgs,
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

/**
 * `phel bench` over the whole project, or over one `.phel` file when `uri` is
 * given (the editor-context entry point). Prompts for the `--filter` substring,
 * which is the option worth reaching for interactively; the measurement knobs
 * (`--revs`, `--iterations`, `--warmup`) belong in the benchmark's own option
 * map, and the baseline flags (`--store`, `--ref`, `--tolerance`) belong in CI.
 */
async function bench(uri?: vscode.Uri): Promise<void> {
    const folder = activeWorkspaceFolder();
    if (!folder) {
        vscode.window.showWarningMessage('Open a Phel project folder first.');
        return;
    }
    const filter = await vscode.window.showInputBox({
        prompt: 'Only run benchmarks whose name contains this text (leave empty for all)',
        placeHolder: 'e.g. sum',
    });
    if (filter === undefined) {
        return; // cancelled
    }
    // bench has no per-command override; resolve from phel.executablePath.
    const command = resolvePhelExecutable(undefined, folder);
    const args = benchArgs({
        paths: uri ? [uri.fsPath] : [],
        filter,
    });
    runInTerminal('Phel Bench', command, args, folder.uri.fsPath);
}

/**
 * One `defbench`, reached from the CodeLens above its name. `phel bench` has no
 * per-name argument, so the name goes through `--filter`, which is a substring
 * match: a benchmark whose name is a prefix of another runs both.
 */
function runBenchmark(uri: vscode.Uri | undefined, name: string): void {
    const folder = activeWorkspaceFolder();
    if (!folder) {
        vscode.window.showWarningMessage('Open a Phel project folder first.');
        return;
    }
    // bench has no per-command override; resolve from phel.executablePath.
    const command = resolvePhelExecutable(undefined, folder);
    const args = benchArgs({ paths: uri ? [uri.fsPath] : [], filter: name });
    runInTerminal('Phel Bench', command, args, folder.uri.fsPath);
}

/**
 * `phel run <file>` on one script: the uri handed over by the explorer / editor
 * title entries, else the active editor's document. The folder comes from the
 * file rather than from the active editor, so running a file from the explorer
 * of a multi-root workspace uses that file's own project root.
 *
 * The path is passed relative to that root, which is where `phel run` resolves
 * it from and keeps the terminal's command line readable.
 */
function runFile(uri?: vscode.Uri): void {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) {
        vscode.window.showWarningMessage('Open a Phel file first.');
        return;
    }
    const folder = vscode.workspace.getWorkspaceFolder(target) ?? activeWorkspaceFolder();
    if (!folder) {
        vscode.window.showWarningMessage('Open a Phel project folder first.');
        return;
    }
    // run has no per-command override; resolve from phel.executablePath.
    const command = resolvePhelExecutable(undefined, folder);
    const relative = path.relative(folder.uri.fsPath, target.fsPath);
    runInTerminal('Phel Run', command, ['run', relative], folder.uri.fsPath);
}

/**
 * `phel balance`. Reporting is the default and `--fix` rewrites files, so the
 * repair is only reached by picking it explicitly — the pick is the
 * confirmation for a command that edits source on disk.
 */
async function balance(): Promise<void> {
    const folder = activeWorkspaceFolder();
    if (!folder) {
        vscode.window.showWarningMessage('Open a Phel project folder first.');
        return;
    }
    const mode = await vscode.window.showQuickPick(
        [
            { label: 'Report only', description: 'List imbalances, change nothing', fix: false },
            {
                label: 'Report and fix',
                description: '--fix: append the missing closers to the files that can take them',
                fix: true,
            },
        ],
        { placeHolder: 'phel balance' }
    );
    if (!mode) {
        return; // cancelled
    }
    // balance has no per-command override; resolve from phel.executablePath.
    const command = resolvePhelExecutable(undefined, folder);
    runInTerminal('Phel Balance', command, balanceArgs({ fix: mode.fix }), folder.uri.fsPath);
}

export function registerCliCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('phel.test.watch', testWatch),
        vscode.commands.registerCommand('phel.build', build),
        vscode.commands.registerCommand('phel.init', init),
        vscode.commands.registerCommand('phel.bench', () => bench()),
        vscode.commands.registerCommand('phel.benchFile', (uri?: vscode.Uri) =>
            bench(uri ?? vscode.window.activeTextEditor?.document.uri)
        ),
        vscode.commands.registerCommand('phel.runBenchmark', (uri?: vscode.Uri, name?: string) => {
            if (name) {
                runBenchmark(uri, name);
            }
        }),
        vscode.commands.registerCommand('phel.runFile', runFile),
        vscode.commands.registerCommand('phel.balance', balance)
    );
}
