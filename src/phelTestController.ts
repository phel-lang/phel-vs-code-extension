// VS Code Test Explorer integration for Phel.
//
// Each `.phel` file with at least one `deftest` becomes a TestItem; each
// `deftest` becomes a child item. There are two ways to run them:
//
//   * over a live nREPL connection, when there is one and `phel.tests.preferNrepl`
//     is on. One `reload` per run brings the session up to date with the files,
//     then one `run-tests` op per `deftest` (`var` set) gives an exact per-test
//     verdict from the `{:pass :fail :error}` map the op returns, with the
//     detail read out of what the reporter printed. Warm, so each op is
//     milliseconds — there is no PHP to boot.
//   * otherwise `phel test --reporter=junit-xml -o <tmp>`, one subprocess per
//     file, parsed back through `junitParser`. This is also the only path a
//     coverage run takes, since `run-tests` collects none.
//
// Tests the run could not account for are marked skipped either way.
//
// `phel.tests.runOnSave` closes the loop: saving a `.phel` file while a
// connection is live reloads and re-runs the tests that saved file affects —
// its own, the test file it maps to, or every test file that requires it.
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
import { normalizeNs, parseNsForm, requireEntries } from './phelNsAnalyzer';
import { layoutOf, pathToNs, testFileFor, type PhelFile } from './phelNsPaths';
import {
    hasLiveNreplConnection,
    reloadViaNrepl,
    runTestsViaNrepl,
    type NreplTestRun,
} from './phelNreplProvider';
import type { PhelTestFailure } from './phelNreplTestReport';
import { phelRuntimeState, type PhelTestRunSummary } from './phelRuntimeState';
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

/** The verdicts one file's run produced, for the runtime-state hub. */
interface Tally {
    pass: number;
    fail: number;
    error: number;
}

interface ResolvedCommand {
    command: string;
    cwd: string;
}

/** True unless the user asked for the subprocess runner in this folder. */
function preferNrepl(folder: vscode.WorkspaceFolder): boolean {
    return vscode.workspace
        .getConfiguration('phel', folder)
        .get<boolean>('tests.preferNrepl', true);
}

function runOnSave(folder: vscode.WorkspaceFolder): boolean {
    return vscode.workspace.getConfiguration('phel', folder).get<boolean>('tests.runOnSave', false);
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
    /** The run-on-save chain per folder, so saves queue rather than overlap. */
    private readonly saveRuns = new Map<string, Promise<void>>();

    constructor(private readonly projectConfig?: PhelProjectConfigProvider) {
        this.controller = vscode.tests.createTestController('phel-tests', 'Phel');
        this.tree = new PhelTestItemTree(this.controller, findDeftests, projectConfig);
        this.disposables.push(this.controller, this.tree);
        this.disposables.push(
            this.controller.createRunProfile(
                'Run',
                vscode.TestRunProfileKind.Run,
                (request, token) => this.run(request, token, false),
                true
            ),
            vscode.workspace.onDidSaveTextDocument((doc) => this.queueSaveRun(doc))
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
        // One `reload` brings a session up to date with every file that changed,
        // so it is worth exactly once per run and per folder.
        const reloaded = new Set<string>();

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

                // A coverage run has to be the subprocess: `run-tests` collects none.
                const ns =
                    !withCoverage && preferNrepl(folder) && hasLiveNreplConnection(folder)
                        ? await nsOfFile(fileItem.uri)
                        : undefined;
                if (ns) {
                    const tally = await this.runOverNrepl(
                        run,
                        folder,
                        fileItem.uri,
                        ns,
                        leaves,
                        token,
                        reloaded
                    );
                    publishRun(ns, leaves.length, tally, 'nrepl');
                    continue;
                }

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

                const tally: Tally = { pass: 0, fail: 0, error: 0 };
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
                            tally.error += 1;
                        }
                        continue;
                    }
                    if (result.passed) {
                        run.passed(leaf);
                        tally.pass += 1;
                    } else {
                        run.failed(leaf, messageFor(result));
                        tally.fail += 1;
                    }
                }
                publishRun(
                    [...outcome.byName.values()][0]?.suite ||
                        (await nsOfFile(fileItem.uri)) ||
                        path.basename(fileItem.uri.fsPath),
                    leaves.length,
                    tally,
                    'cli'
                );
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

    /**
     * Run one file's leaves over the folder's live connection, one `run-tests`
     * op per `deftest`. Per test rather than per file because the op's only
     * structured answer is the summary of what it ran: a whole namespace in one
     * op would say how many assertions failed, not which test they were in.
     */
    private async runOverNrepl(
        run: vscode.TestRun,
        folder: vscode.WorkspaceFolder,
        fileUri: vscode.Uri,
        ns: string,
        leaves: readonly vscode.TestItem[],
        token: vscode.CancellationToken,
        reloaded: Set<string>
    ): Promise<Tally> {
        const tally: Tally = { pass: 0, fail: 0, error: 0 };
        const key = folder.uri.toString();
        if (!reloaded.has(key)) {
            reloaded.add(key);
            try {
                await reloadViaNrepl(folder);
            } catch (err) {
                // A reload that fails leaves the session on the code it had, so
                // the run is still worth doing — with a note about what it ran.
                run.appendOutput(asTerminal(`reload failed: ${messageOf(err)}\n`));
            }
        }

        for (const leaf of leaves) {
            if (token.isCancellationRequested) {
                run.skipped(leaf);
                continue;
            }
            const name = nameForLeaf(leaf);
            const started = Date.now();
            let outcome: NreplTestRun | undefined;
            try {
                outcome = await runTestsViaNrepl(folder, ns, name);
            } catch (err) {
                run.errored(leaf, new vscode.TestMessage(messageOf(err)));
                tally.error += 1;
                continue;
            }
            if (!outcome) {
                // The connection went away between the check above and this op.
                run.errored(
                    leaf,
                    new vscode.TestMessage('The nREPL connection closed during the run.')
                );
                tally.error += 1;
                continue;
            }
            const duration = Date.now() - started;
            if (outcome.out.trim()) {
                run.appendOutput(asTerminal(outcome.out), undefined, leaf);
            }
            const messages = messagesFor(failuresOf(outcome, name), fileUri);
            const summary = outcome.summary;
            if (!summary) {
                run.errored(
                    leaf,
                    new vscode.TestMessage(
                        outcome.err.trim() ||
                            outcome.out.trim() ||
                            `run-tests ${ns}/${name} answered no summary`
                    ),
                    duration
                );
                tally.error += 1;
            } else if (summary.error > 0) {
                run.errored(leaf, fallbackMessages(messages, `${name} errored`), duration);
                tally.error += 1;
            } else if (summary.fail > 0) {
                run.failed(leaf, fallbackMessages(messages, `${name} failed`), duration);
                tally.fail += 1;
            } else if (summary.pass > 0) {
                run.passed(leaf, duration);
                tally.pass += 1;
            } else {
                // The namespace loaded but nothing ran: the `deftest` the item
                // stands for is not in the session (renamed, or never saved).
                run.skipped(leaf);
            }
        }
        return tally;
    }

    /**
     * Saving a `.phel` file re-runs the tests it affects, over the connection
     * that is already open. Runs are chained per folder so two quick saves
     * queue instead of racing each other through the same session.
     */
    private queueSaveRun(doc: vscode.TextDocument): void {
        if (doc.languageId !== 'phel' || doc.uri.scheme !== 'file') {
            return;
        }
        const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
        if (!folder || !runOnSave(folder) || !hasLiveNreplConnection(folder)) {
            return;
        }
        const key = folder.uri.toString();
        const previous = this.saveRuns.get(key) ?? Promise.resolve();
        const next = previous.then(() => this.runAfterSave(folder, doc)).catch(() => undefined);
        this.saveRuns.set(key, next);
    }

    private async runAfterSave(
        folder: vscode.WorkspaceFolder,
        doc: vscode.TextDocument
    ): Promise<void> {
        // The tree is normally built by the Explorer's `resolveHandler`; on save
        // there may be no Testing view open to have asked for it.
        await this.tree.ensureLoaded();
        const items = await this.itemsAffectedBy(folder, doc);
        if (items.length === 0) {
            return;
        }
        const source = new vscode.CancellationTokenSource();
        try {
            await this.run(new vscode.TestRunRequest(items), source.token, false);
        } finally {
            source.dispose();
        }
    }

    /**
     * Which test items a save should re-run, in order of how directly they
     * answer for the file: the file's own `deftest`s, else the test file its
     * namespace maps to, else every test file that requires that namespace.
     */
    private async itemsAffectedBy(
        folder: vscode.WorkspaceFolder,
        doc: vscode.TextDocument
    ): Promise<vscode.TestItem[]> {
        const own = this.tree.itemFor(doc.uri);
        if (own) {
            return [own];
        }
        const relPath = relativeTo(folder, doc.uri);
        const here: PhelFile = {
            relPath,
            ns: parseNsForm(doc.getText())?.name || pathToNs(relPath),
        };
        const layout = layoutOf(this.projectConfig ? await this.projectConfig.get(folder) : null);
        const counterpart = testFileFor(here, layout.srcDirs, layout.testDirs);
        if (counterpart) {
            const item = this.tree.itemFor(
                vscode.Uri.joinPath(folder.uri, ...counterpart.relPath.split('/'))
            );
            if (item) {
                return [item];
            }
        }
        return here.ns ? await this.itemsRequiring(here.ns) : [];
    }

    /** Every file item whose `(ns …)` form requires `ns`. */
    private async itemsRequiring(ns: string): Promise<vscode.TestItem[]> {
        const wanted = normalizeNs(ns);
        const matches: vscode.TestItem[] = [];
        for (const item of this.tree.roots()) {
            if (!item.uri) {
                continue;
            }
            let text: string;
            try {
                text = await fs.readFile(item.uri.fsPath, 'utf-8');
            } catch {
                continue; // deleted since the tree was built
            }
            const requires = requireEntries(parseNsForm(text));
            if (requires.some((entry) => normalizeNs(entry.ns) === wanted)) {
                matches.push(item);
            }
        }
        return matches;
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

/**
 * The namespace a test file declares, read off disk — which is the copy the
 * runtime will load, whatever an unsaved buffer says. Undefined when the file
 * has no `(ns …)` form, which `run-tests` has no way to name.
 */
async function nsOfFile(uri: vscode.Uri): Promise<string | undefined> {
    try {
        return parseNsForm(await fs.readFile(uri.fsPath, 'utf-8'))?.name || undefined;
    } catch {
        return undefined;
    }
}

/**
 * The failures in one op's report that belong to `name`. One op runs one
 * `deftest`, so this is normally all of them; the filter is what keeps a
 * reporter that ever printed more from being attributed to the wrong item.
 */
function failuresOf(outcome: NreplTestRun, name: string): PhelTestFailure[] {
    const mine = outcome.failures.filter((failure) => failure.testName === name);
    return mine.length > 0 ? mine : outcome.failures;
}

/**
 * One TestMessage per failing assertion: the verbatim block the reporter
 * printed, as a diff when the failure carries both sides of one, anchored at
 * the location the headline named when that names this file.
 */
function messagesFor(
    failures: readonly PhelTestFailure[],
    fileUri: vscode.Uri
): vscode.TestMessage[] {
    const basename = path.basename(fileUri.fsPath);
    return failures.map((failure) => {
        const text = [failure.message, failure.detail].filter(Boolean).join('\n');
        const message =
            failure.expected !== undefined && failure.actual !== undefined
                ? vscode.TestMessage.diff(text, failure.expected, failure.actual)
                : new vscode.TestMessage(text);
        if (failure.line !== undefined && failure.file === basename) {
            // The reporter's line is 1-based, and points at the enclosing
            // `(deftest …)` rather than the assertion (see phelNreplTestReport).
            message.location = new vscode.Location(
                fileUri,
                new vscode.Position(Math.max(0, failure.line - 1), 0)
            );
        }
        return message;
    });
}

/** A verdict needs a message even when the reporter printed no block for it. */
function fallbackMessages(
    messages: vscode.TestMessage[],
    text: string
): vscode.TestMessage[] | vscode.TestMessage {
    return messages.length > 0 ? messages : new vscode.TestMessage(text);
}

/** `appendOutput` writes into a terminal, where a bare LF does not return. */
function asTerminal(text: string): string {
    return text.replace(/\r?\n/g, '\r\n');
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function relativeTo(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string {
    return path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join('/');
}

/** Leave the run where `phel.status.describe` can report it. */
function publishRun(ns: string, count: number, tally: Tally, via: PhelTestRunSummary['via']): void {
    phelRuntimeState.setLastTestRun({ ns, count, ...tally, via });
}
