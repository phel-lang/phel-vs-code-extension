// VS Code Test Explorer integration for Phel.
//
// Each `.phel` file with at least one `deftest` becomes a TestItem; each
// `deftest` becomes a child item. Running an item shells out to `phel test
// --filter` and reports pass / fail based on the exit code. We don't parse
// the textual output yet — when the Phel CLI gains structured (JSON / TAP)
// output we can attach per-assertion messages.

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { findDeftests } from './phelTestScanner';

interface ResolvedCommand {
    command: string;
    args: string[];
    cwd: string;
}

function resolveTestCommand(folder: vscode.WorkspaceFolder): ResolvedCommand {
    const config = vscode.workspace.getConfiguration('phel', folder);
    const cmd = config.get<string>('test.command', 'vendor/bin/phel');
    const cwd = folder.uri.fsPath;
    const command = path.isAbsolute(cmd) ? cmd : path.join(cwd, cmd);
    return { command, args: ['test'], cwd };
}

async function readFile(uri: vscode.Uri): Promise<string | null> {
    try {
        return await fs.readFile(uri.fsPath, 'utf-8');
    } catch {
        return null;
    }
}

function attachItems(
    controller: vscode.TestController,
    file: vscode.Uri,
    text: string
): vscode.TestItem | null {
    const tests = findDeftests(text);
    if (tests.length === 0) {
        controller.items.delete(file.toString());
        return null;
    }
    const fileItem =
        controller.items.get(file.toString()) ??
        controller.createTestItem(file.toString(), path.basename(file.fsPath), file);
    fileItem.children.replace(
        tests.map((t) => {
            const id = `${file.toString()}::${t.name}`;
            const item = controller.createTestItem(id, t.name, file);
            item.range = new vscode.Range(t.line, t.nameCol, t.line, t.nameCol + t.name.length);
            return item;
        })
    );
    controller.items.add(fileItem);
    return fileItem;
}

async function loadAllTests(controller: vscode.TestController): Promise<void> {
    const uris = await vscode.workspace.findFiles('**/*.phel', '**/node_modules/**');
    for (const uri of uris) {
        const text = await readFile(uri);
        if (text === null) {
            continue;
        }
        attachItems(controller, uri, text);
    }
}

interface TestRunOutcome {
    code: number;
    output: string;
}

function runPhelTest(folder: vscode.WorkspaceFolder, filter: string): Promise<TestRunOutcome> {
    return new Promise((resolve) => {
        const cmd = resolveTestCommand(folder);
        const proc = spawn(cmd.command, [...cmd.args, '--filter', filter], { cwd: cmd.cwd });
        let output = '';
        proc.stdout?.on('data', (d) => {
            output += d.toString();
        });
        proc.stderr?.on('data', (d) => {
            output += d.toString();
        });
        proc.on('close', (code) => resolve({ code: code ?? 1, output }));
        proc.on('error', (err) => resolve({ code: 1, output: err.message }));
    });
}

function expandQueue(
    queue: readonly vscode.TestItem[],
    request: vscode.TestRunRequest
): vscode.TestItem[] {
    const flat: vscode.TestItem[] = [];
    const visit = (item: vscode.TestItem): void => {
        if (request.exclude?.includes(item)) {
            return;
        }
        if (item.children.size === 0) {
            flat.push(item);
            return;
        }
        item.children.forEach(visit);
    };
    for (const item of queue) {
        visit(item);
    }
    return flat;
}

function filterFor(item: vscode.TestItem): string {
    const sep = item.id.indexOf('::');
    if (sep < 0) {
        return '.*';
    }
    return `^${escapeRegex(item.id.slice(sep + 2))}$`;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class PhelTestController implements vscode.Disposable {
    private readonly controller: vscode.TestController;
    private readonly disposables: vscode.Disposable[] = [];

    constructor() {
        this.controller = vscode.tests.createTestController('phel-tests', 'Phel');
        this.disposables.push(this.controller);
        this.controller.resolveHandler = async () => {
            await loadAllTests(this.controller);
        };
        this.controller.createRunProfile(
            'Run',
            vscode.TestRunProfileKind.Run,
            (request, token) => this.run(request, token),
            true
        );
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument(async (doc) => {
                if (doc.languageId !== 'phel') {
                    return;
                }
                attachItems(this.controller, doc.uri, doc.getText());
            })
        );
    }

    private async run(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken
    ): Promise<void> {
        const queue: vscode.TestItem[] = [];
        if (request.include) {
            queue.push(...request.include);
        } else {
            this.controller.items.forEach((it) => queue.push(it));
        }
        const items = expandQueue(queue, request);
        const run = this.controller.createTestRun(request);
        for (const item of items) {
            if (token.isCancellationRequested) {
                break;
            }
            const folder = item.uri ? vscode.workspace.getWorkspaceFolder(item.uri) : undefined;
            if (!folder) {
                run.skipped(item);
                continue;
            }
            run.started(item);
            const outcome = await runPhelTest(folder, filterFor(item));
            if (outcome.code === 0) {
                run.passed(item);
            } else {
                run.failed(item, new vscode.TestMessage(outcome.output || `exit ${outcome.code}`));
            }
        }
        run.end();
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
