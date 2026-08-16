// VS Code Test Explorer integration for Phel.
//
// Each `.phel` file with at least one `deftest` becomes a TestItem; each
// `deftest` becomes a child item. Running items shells out to
// `phel test --reporter=junit-xml -o <tmp>` and parses the JUnit report, so
// individual tests get pass / fail status plus the failing assertion message
// and (for the failing form) detail. Tests not present in the report are
// marked skipped.
//
// The item tree itself — discovery, the watcher that keeps it current, and the
// grouping of a run request — is shared with the benchmark controller and lives
// in `phelTestItems`.

import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { resolvePhelExecutable } from './phelExecutable';
import { runPhelCli } from './phelCli';
import { coverageEnv } from './phelInvocation';
import type { PhelProjectConfigProvider } from './phelProjectConfigProvider';
import { findDeftests } from './phelTestScanner';
import { PhelTestItemTree, groupQueue, nameForLeaf } from './phelTestItems';
import { pathFromCli } from './phelWorkspace';
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

    const result = await runPhelCli(cmd.command, args, cmd.cwd, {
        token,
        env: coveragePath ? coverageEnv(process.env.XDEBUG_MODE) : undefined,
    });
    const outcome = { code: result.code, output: result.stdout + result.stderr };

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

/**
 * Build one FileCoverage (and cache its per-line detail) for the source file
 * `uri` names, from all Clover entries that referenced it during the run. A
 * line is covered if it was executed in any entry; the summary counts come
 * from the merged set.
 */
function mergeCoverage(
    uri: vscode.Uri,
    entries: readonly CloverFile[],
    detailStore: Map<string, vscode.StatementCoverage[]>
): vscode.FileCoverage {
    const coveredByLine = new Map<number, boolean>();
    for (const entry of entries) {
        for (const l of entry.lines) {
            coveredByLine.set(l.line, (coveredByLine.get(l.line) ?? false) || l.covered);
        }
    }

    const details: vscode.StatementCoverage[] = [];
    let covered = 0;
    for (const [line, isCovered] of coveredByLine) {
        details.push(
            new vscode.StatementCoverage(
                isCovered,
                // Clover line numbers are 1-based; VS Code positions are 0-based.
                new vscode.Position(Math.max(0, line - 1), 0)
            )
        );
        if (isCovered) {
            covered += 1;
        }
    }

    detailStore.set(uri.toString(), details);
    return new vscode.FileCoverage(uri, new vscode.TestCoverageCount(covered, coveredByLine.size));
}

export class PhelTestController implements vscode.Disposable {
    private readonly controller: vscode.TestController;
    private readonly tree: PhelTestItemTree;
    private readonly disposables: vscode.Disposable[] = [];
    /** Per-run cache of detailed line coverage, keyed by file URI string. */
    private coverageDetails = new Map<string, vscode.StatementCoverage[]>();

    constructor(projectConfig?: PhelProjectConfigProvider) {
        this.controller = vscode.tests.createTestController('phel-tests', 'Phel');
        this.tree = new PhelTestItemTree(this.controller, findDeftests, projectConfig);
        this.disposables.push(this.controller, this.tree);
        this.disposables.push(
            this.controller.createRunProfile(
                'Run',
                vscode.TestRunProfileKind.Run,
                (request, token) => this.run(request, token, false),
                true
            )
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
            this.disposables.push(coverageProfile);
        }
    }

    private async run(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken,
        withCoverage: boolean
    ): Promise<void> {
        const byFile = groupQueue(request.include ?? this.tree.roots(), request);
        const run = this.controller.createTestRun(request);
        if (withCoverage) {
            this.coverageDetails = new Map();
        }
        // Accumulate coverage across files so a source executed by several test
        // files yields one merged FileCoverage rather than duplicate entries.
        const coverageByUri = new Map<string, CloverFile[]>();
        let warnedNoDriver = false;

        try {
            for (const [fileItem, leaves] of byFile) {
                if (token.isCancellationRequested) {
                    // VS Code expects every started item to reach a terminal
                    // state; mark the rest skipped instead of leaving them spinning.
                    leaves.forEach((l) => run.skipped(l));
                    continue;
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

                if (token.isCancellationRequested) {
                    leaves.forEach((l) => run.skipped(l));
                    continue;
                }

                if (withCoverage) {
                    for (const entry of outcome.coverage) {
                        // Clover names every file by its resolved path; keyed
                        // that way the coverage would decorate a document the
                        // editor considers a different file.
                        const file = pathFromCli(entry.file, folder);
                        const list = coverageByUri.get(file) ?? [];
                        list.push(entry);
                        coverageByUri.set(file, list);
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
                    // match by name. Tests run one file per subprocess, so the
                    // report only contains this file's tests — names are unique
                    // within a file.
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

            if (withCoverage) {
                for (const [file, entries] of coverageByUri) {
                    run.addCoverage(
                        mergeCoverage(vscode.Uri.file(file), entries, this.coverageDetails)
                    );
                }
            }
        } finally {
            run.end();
        }
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
