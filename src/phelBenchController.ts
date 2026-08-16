// VS Code Test Explorer integration for Phel benchmarks.
//
// Each `.phel` file with at least one `defbench` becomes a TestItem; each
// `defbench` becomes a child item. Running items shells out to
// `phel bench <file>` and parses the table it prints, so every benchmark gets
// its mean as the item's duration and the whole table as run output.
//
// This is a controller of its own rather than a second run profile on
// `phel-tests`. A file can hold both a `deftest` and a `defbench` — the
// integration fixture does — so a single controller would need one item per
// file carrying both kinds of children plus a TestTag on every profile to keep
// "Run All Tests" from timing a benchmark. Two controllers give the Explorer
// two roots, which is also how a reader of the tree thinks about them.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { resolvePhelExecutable } from './phelExecutable';
import { runPhelCli } from './phelCli';
import { benchArgs } from './phelCliCommands';
import type { PhelProjectConfigProvider } from './phelProjectConfigProvider';
import { findDefbenches } from './phelTestScanner';
import { PhelTestItemTree, groupQueue, nameForLeaf } from './phelTestItems';
import { type PhelBenchRow, parseBenchTable } from './phelBenchOutput';

interface BenchRunOutcome {
    /** Parsed table rows, keyed by the benchmark name without its namespace. */
    byName: Map<string, PhelBenchRow>;
    /** Everything the run printed, for the run output pane. */
    output: string;
    /** What to put in a TestMessage when there was no table. */
    error: string;
}

/**
 * Run `phel bench` for one file and return the parsed rows. The file is passed
 * as a positional path so every `defbench` in it is measured in one subprocess;
 * `--filter` narrows that down when the Explorer asked for a single benchmark.
 *
 * `bench` has no per-command override, so the executable resolves straight from
 * `phel.executablePath`.
 */
async function runPhelBenchFile(
    folder: vscode.WorkspaceFolder,
    fileUri: vscode.Uri,
    filter: string | undefined,
    token: vscode.CancellationToken
): Promise<BenchRunOutcome> {
    const cwd = folder.uri.fsPath;
    const command = resolvePhelExecutable(undefined, folder);
    const relPath = path.relative(cwd, fileUri.fsPath) || fileUri.fsPath;
    const result = await runPhelCli(command, benchArgs({ paths: [relPath], filter }), cwd, {
        token,
    });

    const output = result.stdout + result.stderr;
    const byName = new Map<string, PhelBenchRow>();
    for (const row of parseBenchTable(result.stdout)) {
        byName.set(shortName(row.benchmark), row);
    }
    return {
        byName,
        output,
        // The runner reports "No benchmarks found in the given paths." on
        // stderr and a compile error through the stack-trace writer, so stderr
        // is the useful half; fall back to the rest when it is empty.
        error: result.stderr.trim() || output.trim() || `phel bench exited ${result.code}`,
    };
}

/** `ns/name` → `name`; neither half can contain a slash. */
function shortName(benchmark: string): string {
    return benchmark.slice(benchmark.lastIndexOf('/') + 1);
}

/**
 * `run.appendOutput` writes into a terminal, which moves the cursor down on a
 * newline but only returns it on a carriage return. Without this every row
 * after the first starts where the previous one ended.
 */
function forTerminal(text: string): string {
    return text.replace(/\r?\n/g, '\r\n');
}

export class PhelBenchController implements vscode.Disposable {
    private readonly controller: vscode.TestController;
    private readonly tree: PhelTestItemTree;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(projectConfig?: PhelProjectConfigProvider) {
        this.controller = vscode.tests.createTestController('phel-benchmarks', 'Phel Benchmarks');
        this.tree = new PhelTestItemTree(this.controller, findDefbenches, projectConfig);
        this.disposables.push(
            this.controller,
            this.tree,
            this.controller.createRunProfile(
                'Benchmark',
                vscode.TestRunProfileKind.Run,
                (request, token) => this.run(request, token),
                true
            )
        );
    }

    private async run(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken
    ): Promise<void> {
        const byFile = groupQueue(request.include ?? this.tree.roots(), request);
        const run = this.controller.createTestRun(request);

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

                // `--filter` is a substring match, so it can only stand in for a
                // single name; asking for several means running the file and
                // ignoring the rows nobody asked for.
                const filter = leaves.length === 1 ? nameForLeaf(leaves[0]) : undefined;
                const outcome = await runPhelBenchFile(folder, fileItem.uri, filter, token);

                if (token.isCancellationRequested) {
                    leaves.forEach((l) => run.skipped(l));
                    continue;
                }

                run.appendOutput(forTerminal(outcome.output));

                for (const leaf of leaves) {
                    const row = outcome.byName.get(nameForLeaf(leaf));
                    if (!row) {
                        // No table at all is a failed run; a table without this
                        // row means `--filter` or the runner left it out.
                        if (outcome.byName.size === 0) {
                            run.errored(leaf, new vscode.TestMessage(outcome.error));
                        } else {
                            run.skipped(leaf);
                        }
                        continue;
                    }
                    // A benchmark cannot fail, only take time. The Explorer
                    // shows a duration in milliseconds.
                    run.passed(leaf, row.meanNs / 1e6);
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
