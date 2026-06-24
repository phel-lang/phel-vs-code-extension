// VS Code Test Explorer integration for Phel.
//
// Each `.phel` file with at least one `deftest` becomes a TestItem; each
// `deftest` becomes a child item. Running items shells out to
// `phel test --reporter=junit-xml -o <tmp>` and parses the JUnit report, so
// individual tests get pass / fail status plus the failing assertion message
// and (for the failing form) detail. Tests not present in the report are
// marked skipped.

import { spawn } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { resolvePhelExecutable } from './phelExecutable';
import { findDeftests } from './phelTestScanner';
import { type AggregatedCase, groupByName, parseJUnit } from './junitParser';
import { type CloverFile, parseClover } from './cloverParser';

/** True when the running VS Code build exposes the test-coverage API (1.88+). */
const COVERAGE_API_AVAILABLE =
    typeof vscode.TestRunProfileKind.Coverage === 'number' &&
    typeof vscode.FileCoverage === 'function' &&
    typeof vscode.StatementCoverage === 'function';

const NO_COVERAGE_DRIVER_RE = /--coverage requires the pcov or xdebug extension/i;

interface ResolvedCommand {
    command: string;
    cwd: string;
}

function resolveTestCommand(folder: vscode.WorkspaceFolder): ResolvedCommand {
    return {
        command: resolvePhelExecutable('test.command', folder),
        cwd: folder.uri.fsPath,
    };
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

interface JUnitRunOutcome {
    /** Aggregated results keyed by test name (the deftest name). */
    byName: Map<string, AggregatedCase>;
    /** Raw combined stdout+stderr, surfaced when the report is missing. */
    output: string;
    code: number;
    /** True when a JUnit report was produced and parsed. */
    parsed: boolean;
    /** Per-file line coverage, when a coverage run produced a Clover report. */
    coverage: CloverFile[];
    /** True when coverage was requested but no pcov/xdebug driver was available. */
    coverageDriverMissing: boolean;
}

function tmpReport(kind: string, ext: string): string {
    return path.join(
        os.tmpdir(),
        `phel-${kind}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    );
}

/**
 * Run `phel test` for one file with the JUnit reporter (and optionally the
 * Clover coverage reporter) and return the parsed, per-test results. We pass
 * the file as a positional path so every `deftest` in it runs in a single
 * subprocess.
 */
async function runPhelTestFile(
    folder: vscode.WorkspaceFolder,
    fileUri: vscode.Uri,
    token: vscode.CancellationToken,
    withCoverage: boolean
): Promise<JUnitRunOutcome> {
    const cmd = resolveTestCommand(folder);
    const relPath = path.relative(cmd.cwd, fileUri.fsPath) || fileUri.fsPath;
    const reportPath = tmpReport('junit', 'xml');
    const coveragePath = withCoverage ? tmpReport('clover', 'xml') : undefined;
    const args = ['test', '--reporter=junit-xml', '-o', reportPath];
    if (coveragePath) {
        args.push('--coverage=clover', `--coverage-output=${coveragePath}`);
    }
    args.push(relPath);

    const outcome = await new Promise<{ code: number; output: string }>((resolve) => {
        const proc = spawn(cmd.command, args, { cwd: cmd.cwd });
        let output = '';
        proc.stdout?.on('data', (d) => (output += d.toString()));
        proc.stderr?.on('data', (d) => (output += d.toString()));
        proc.on('close', (code) => resolve({ code: code ?? 1, output }));
        proc.on('error', (err) => resolve({ code: 1, output: err.message }));
        token.onCancellationRequested(() => proc.kill());
    });

    let byName = new Map<string, AggregatedCase>();
    let parsed = false;
    try {
        const xml = await fs.readFile(reportPath, 'utf-8');
        byName = groupByName(parseJUnit(xml));
        parsed = byName.size > 0 || xml.includes('<testsuite');
    } catch {
        // No report written (e.g. a compile error before any test ran).
    } finally {
        await fs.rm(reportPath, { force: true }).catch(() => undefined);
    }

    let coverage: CloverFile[] = [];
    if (coveragePath) {
        try {
            coverage = parseClover(await fs.readFile(coveragePath, 'utf-8'));
        } catch {
            // No coverage file (driver missing, or no source executed).
        } finally {
            await fs.rm(coveragePath, { force: true }).catch(() => undefined);
        }
    }

    return {
        byName,
        output: outcome.output,
        code: outcome.code,
        parsed,
        coverage,
        coverageDriverMissing: withCoverage && NO_COVERAGE_DRIVER_RE.test(outcome.output),
    };
}

interface QueueGroups {
    /** File item → the set of leaf test items requested under it. */
    byFile: Map<vscode.TestItem, vscode.TestItem[]>;
}

function groupQueue(
    queue: readonly vscode.TestItem[],
    request: vscode.TestRunRequest
): QueueGroups {
    const byFile = new Map<vscode.TestItem, vscode.TestItem[]>();
    const addLeaf = (item: vscode.TestItem): void => {
        if (request.exclude?.includes(item)) {
            return;
        }
        // A leaf (deftest) item has an id of the form "<fileUri>::<name>".
        const isLeaf = item.id.includes('::');
        const fileItem = isLeaf ? item.parent : item;
        if (!fileItem) {
            return;
        }
        const leaves = byFile.get(fileItem) ?? [];
        if (isLeaf) {
            leaves.push(item);
        } else {
            item.children.forEach((child) => {
                if (!request.exclude?.includes(child)) {
                    leaves.push(child);
                }
            });
        }
        byFile.set(fileItem, leaves);
    };
    for (const item of queue) {
        addLeaf(item);
    }
    return { byFile };
}

function nameForLeaf(item: vscode.TestItem): string {
    const sep = item.id.indexOf('::');
    return sep < 0 ? item.label : item.id.slice(sep + 2);
}

function messageFor(aggregated: AggregatedCase): vscode.TestMessage[] {
    return aggregated.failures.map((f) => {
        const parts = [f.message || (f.isError ? 'Error' : 'Assertion failed')];
        if (f.detail) {
            parts.push('', f.detail);
        }
        if (f.type) {
            parts.push('', `(${f.type})`);
        }
        return new vscode.TestMessage(parts.join('\n'));
    });
}

/** Build a FileCoverage (+ cache its per-line detail) from a Clover file entry. */
function toFileCoverage(
    entry: CloverFile,
    detailStore: Map<string, vscode.StatementCoverage[]>
): vscode.FileCoverage {
    const uri = vscode.Uri.file(entry.file);
    const details = entry.lines.map(
        (l) =>
            new vscode.StatementCoverage(
                l.covered,
                // Clover line numbers are 1-based; VS Code positions are 0-based.
                new vscode.Position(Math.max(0, l.line - 1), 0)
            )
    );
    detailStore.set(uri.toString(), details);
    return new vscode.FileCoverage(
        uri,
        new vscode.TestCoverageCount(entry.coveredStatements, entry.statements)
    );
}

export class PhelTestController implements vscode.Disposable {
    private readonly controller: vscode.TestController;
    private readonly disposables: vscode.Disposable[] = [];
    /** Per-run cache of detailed line coverage, keyed by file URI string. */
    private coverageDetails = new Map<string, vscode.StatementCoverage[]>();

    constructor() {
        this.controller = vscode.tests.createTestController('phel-tests', 'Phel');
        this.disposables.push(this.controller);
        this.controller.resolveHandler = async () => {
            await loadAllTests(this.controller);
        };
        this.controller.createRunProfile(
            'Run',
            vscode.TestRunProfileKind.Run,
            (request, token) => this.run(request, token, false),
            true
        );
        if (COVERAGE_API_AVAILABLE) {
            const coverageProfile = this.controller.createRunProfile(
                'Run with Coverage',
                vscode.TestRunProfileKind.Coverage,
                (request, token) => this.run(request, token, true),
                true
            );
            coverageProfile.loadDetailedCoverage = (_run, fileCoverage) =>
                Promise.resolve(this.coverageDetails.get(fileCoverage.uri.toString()) ?? []);
        }
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
        token: vscode.CancellationToken,
        withCoverage: boolean
    ): Promise<void> {
        const queue: vscode.TestItem[] = [];
        if (request.include) {
            queue.push(...request.include);
        } else {
            this.controller.items.forEach((it) => queue.push(it));
        }
        const { byFile } = groupQueue(queue, request);
        const run = this.controller.createTestRun(request);
        if (withCoverage) {
            this.coverageDetails = new Map();
        }
        let warnedNoDriver = false;

        for (const [fileItem, leaves] of byFile) {
            if (token.isCancellationRequested) {
                break;
            }
            const folder = fileItem.uri
                ? vscode.workspace.getWorkspaceFolder(fileItem.uri)
                : undefined;
            if (!folder || !fileItem.uri) {
                leaves.forEach((l) => run.skipped(l));
                continue;
            }
            leaves.forEach((l) => run.started(l));

            const outcome = await runPhelTestFile(folder, fileItem.uri, token, withCoverage);

            if (withCoverage) {
                for (const entry of outcome.coverage) {
                    run.addCoverage(toFileCoverage(entry, this.coverageDetails));
                }
                if (outcome.coverageDriverMissing && !warnedNoDriver) {
                    warnedNoDriver = true;
                    vscode.window.showWarningMessage(
                        'Phel coverage needs the pcov or xdebug PHP extension; tests ran without coverage.'
                    );
                }
            }

            for (const leaf of leaves) {
                const name = nameForLeaf(leaf);
                // A leaf only knows the deftest name, not its namespace, so we
                // match by name (test names are unique within a file).
                const result = findByName(outcome.byName, name);
                if (!result) {
                    if (outcome.parsed) {
                        run.skipped(leaf);
                    } else {
                        run.errored(
                            leaf,
                            new vscode.TestMessage(
                                outcome.output.trim() || `phel test exited ${outcome.code}`
                            )
                        );
                    }
                    continue;
                }
                if (result.passed) {
                    run.passed(leaf);
                } else {
                    run.failed(leaf, messageFor(result));
                }
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

function findByName(byName: Map<string, AggregatedCase>, name: string): AggregatedCase | undefined {
    for (const value of byName.values()) {
        if (value.name === name) {
            return value;
        }
    }
    return undefined;
}
