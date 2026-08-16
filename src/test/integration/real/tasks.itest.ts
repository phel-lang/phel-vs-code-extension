// The `phel` task type against the real CLI: the `lint` task runs, exits with
// the code the linter chose, and `$phel-lint` turns its output into problems.
//
// The unit suite already checks the matcher's regex against captured output;
// what only a real run can show is that the output the CLI produces *today*
// still matches, and that the markers reach the editor.

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { activateExtension, projectUri, waitFor } from './support';

/**
 * Every diagnostic on `target`, however the reporter spelled the path.
 *
 * A task's markers are built by VS Code from the CLI's output, before this
 * extension sees a line of it, and the CLI resolves symlinks in what it prints.
 * On a workspace opened through one — which `mktemp -d` on macOS is, `/var`
 * being a symlink to `/private/var` — the markers land on the resolved
 * spelling and the extension cannot map them back; see docs/troubleshooting.md.
 */
function diagnosticsOnFile(target: vscode.Uri): vscode.Diagnostic[] {
    const real = fs.realpathSync(target.fsPath);
    return vscode.languages
        .getDiagnostics()
        .filter(([uri]) => {
            try {
                return fs.realpathSync(uri.fsPath) === real;
            } catch {
                // Not a file on disk (or gone); it is not the one we asked for.
                return false;
            }
        })
        .flatMap(([, diagnostics]) => diagnostics);
}

/** Run `task` to completion and answer with the exit code of its process. */
async function runTask(task: vscode.Task): Promise<number | undefined> {
    let ended: vscode.TaskProcessEndEvent | undefined;
    const sub = vscode.tasks.onDidEndTaskProcess((e) => {
        if (e.execution.task.name === task.name) {
            ended = e;
        }
    });
    try {
        await vscode.tasks.executeTask(task);
        return (await waitFor(`the ${task.name} task to exit`, () => ended, 120_000)).exitCode;
    } finally {
        sub.dispose();
    }
}

describe('the phel lint task', function () {
    let lint: vscode.Task;

    before(async function () {
        await activateExtension();
        const tasks = await vscode.tasks.fetchTasks({ type: 'phel' });
        const found = tasks.find((task) => task.name === 'lint');
        assert.ok(found, `no lint task among ${tasks.map((t) => t.name).join(', ')}`);
        lint = found;

        // `src/broken.phel` is never opened by a suite, so the on-open / on-save
        // passes have never reported on it. Anything on it after the task ran
        // came from the matcher.
        assert.deepEqual(diagnosticsOnFile(projectUri('src', 'broken.phel')), []);
    });

    it('exits 1 over a project that has a lint error in it', async function () {
        assert.deepEqual(lint.problemMatchers, ['$phel-lint']);
        assert.equal(await runTask(lint), 1);
    });

    it('turns what the linter printed into problems on the file it named', async function () {
        // A task's markers are owned by the matcher, not by a diagnostic
        // collection of ours, and they arrive after the process has exited.
        const uri = projectUri('src', 'broken.phel');
        const diagnostic = await waitFor(
            'the $phel-lint matcher to report the unresolved symbol',
            () => diagnosticsOnFile(uri).find((d) => d.code === 'phel/unresolved-symbol'),
            30_000
        );

        assert.equal(diagnostic.severity, vscode.DiagnosticSeverity.Error);
        assert.equal(diagnostic.message, "Cannot resolve symbol 'no-such-symbol'");
        // `(no-such-symbol 1 2)` on the fourth line, column 3 as the CLI counts.
        assert.equal(diagnostic.range.start.line, 3);
    });
});
