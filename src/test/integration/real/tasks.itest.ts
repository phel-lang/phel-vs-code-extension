// The `phel` task type against the real CLI: the `lint` task runs, exits with
// the code the linter chose, and `$phel-lint` turns its output into problems.
//
// The unit suite already checks the matcher's regex against captured output;
// what only a real run can show is that the output the CLI produces *today*
// still matches, that the markers reach the editor, and that filing them leaves
// the extension's own diagnostics where they were — the matchers used to report
// under the marker owner the on-save `phel lint` pass writes to, so a task run
// wiped what that pass had found.

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { activateExtension, openProject, projectUri, waitFor } from './support';

/** The only thing anything reports on `src/lint_only.phel`. */
const COMMENT_STYLE = 'phel/comment-style';

/** Whether `uri` names the file at `real`, however the two are spelled. */
function isFile(uri: vscode.Uri, real: string): boolean {
    try {
        return fs.realpathSync(uri.fsPath) === real;
    } catch {
        // Not a file on disk (or gone); it is not the one we asked for.
        return false;
    }
}

/**
 * Every uri the editor holds diagnostics under that names `target`.
 *
 * A task's markers are built by VS Code from the CLI's output, before this
 * extension sees a line of it, and the CLI resolves symlinks in what it prints.
 * On a workspace opened through one — which `mktemp -d` on macOS is, `/var`
 * being a symlink to `/private/var` — the markers land on the resolved
 * spelling and the extension cannot map them back; see docs/troubleshooting.md.
 * So one file can be two uris, one per half of the picture.
 */
function diagnosticUris(target: vscode.Uri): vscode.Uri[] {
    const real = fs.realpathSync(target.fsPath);
    return vscode.languages
        .getDiagnostics()
        .filter(([uri]) => isFile(uri, real))
        .map(([uri]) => uri);
}

/** Every diagnostic on `target`, however the reporter spelled the path. */
function diagnosticsOnFile(target: vscode.Uri): vscode.Diagnostic[] {
    return diagnosticUris(target).flatMap((uri) => vscode.languages.getDiagnostics(uri));
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

/**
 * Run `task` and resolve once the markers of that run have been filed.
 *
 * The process exiting is not the end of a run: VS Code then hands the output to
 * the matcher, files its markers, and drops the ones the previous run left on
 * files this one did not report — all after `onDidEndTaskProcess`. Waiting for
 * a marker to *appear* only works for the first run, since afterwards it is
 * already there; what every run does produce is a change on `sentinel`, a file
 * each of them reports on.
 */
async function runTaskAndWaitForMarkers(task: vscode.Task, sentinel: vscode.Uri): Promise<void> {
    const real = fs.realpathSync(sentinel.fsPath);
    let filed = false;
    const sub = vscode.languages.onDidChangeDiagnostics((e) => {
        filed = filed || e.uris.some((uri) => isFile(uri, real));
    });
    try {
        await runTask(task);
        await waitFor(
            `the ${task.name} run to file its markers`,
            () => (filed ? true : undefined),
            30_000
        );
    } finally {
        sub.dispose();
    }
}

/**
 * The uris the editor announced a diagnostic change on while `body` ran.
 *
 * That announcement is the only view a test has of the markers the *editor*
 * holds: a `DiagnosticCollection` keeps its own copy in the extension host, so
 * `languages.getDiagnostics` still answers with a finding whose marker the
 * editor has dropped. Which file was touched does come across — and a task run
 * has no business touching one it did not report on.
 */
async function urisTouchedDuring(body: () => Promise<void>): Promise<Set<string>> {
    const touched = new Set<string>();
    const sub = vscode.languages.onDidChangeDiagnostics((e) =>
        e.uris.forEach((uri) => touched.add(uri.toString()))
    );
    try {
        await body();
    } finally {
        sub.dispose();
    }
    return touched;
}

/**
 * Wait until nothing has changed the diagnostics on `uri` for `quietMs`.
 *
 * Opening a file sets several passes going — the on-open `phel lint`, the
 * analysis daemon, the unused-local and migration analyzers — and each
 * announces itself on the file it reports on. What is asserted below is which
 * files a *task* run announces, so the file has to have gone quiet first.
 */
async function quietOn(uri: vscode.Uri, quietMs = 1500): Promise<void> {
    let last = Date.now();
    const sub = vscode.languages.onDidChangeDiagnostics((e) => {
        if (e.uris.some((u) => u.toString() === uri.toString())) {
            last = Date.now();
        }
    });
    try {
        await waitFor(
            `the diagnostics on ${uri.fsPath} to settle`,
            () => (Date.now() - last >= quietMs ? true : undefined),
            60_000
        );
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

    it('leaves the diagnostics the extension owns standing, run after run', async function () {
        // Opened here and nowhere else, so the `phel lint` pass — which runs on
        // open as well as on save — reports on it for the first time now, after
        // the runs above, which under a shared owner would have cleared it.
        const uri = projectUri('src', 'lint_only.phel');
        await openProject('src', 'lint_only.phel');
        const ours = () =>
            vscode.languages.getDiagnostics(uri).filter((d) => d.code === COMMENT_STYLE);
        await waitFor(
            `the lint pass to report the ${COMMENT_STYLE}`,
            () => (ours().length === 1 ? true : undefined),
            60_000
        );

        // What the assertion below rests on: the editor tells the extension host
        // about a file's markers only while none of the extension's own are left
        // on it, so a run that clears this finding is one the host hears about —
        // as long as nothing else of ours reports on the same file.
        assert.deepEqual(
            [...new Set(vscode.languages.getDiagnostics(uri).map((d) => d.code))],
            [COMMENT_STYLE],
            'something other than the lint pass reports on lint_only.phel'
        );
        await quietOn(uri);

        const sentinel = projectUri('src', 'broken.phel');
        const touched = await urisTouchedDuring(async () => {
            await runTaskAndWaitForMarkers(lint, sentinel);
            // Twice: a re-run drops the markers of the previous one before
            // filing its own, and the second run's report cannot reach here
            // ahead of the first run's clean-up.
            await runTaskAndWaitForMarkers(lint, sentinel);
        });

        assert.equal(ours().length, 1, 'the extension lost its own diagnostic over the runs');
        // The task lints the whole project, so it reported on this file too —
        // under the path the CLI printed, which on a project reached through a
        // symlink (`mktemp -d` on macOS) is a second uri for the same file. Only
        // there are the two halves distinguishable, and there a matcher owning
        // its own markers has no reason to touch the editor's spelling at all.
        await waitFor(
            'the task to report the same finding on lint_only.phel',
            () => (diagnosticsOnFile(uri).length === 2 ? true : undefined),
            30_000
        );
        const spellings = diagnosticUris(uri);
        if (spellings.length > 1) {
            assert.equal(
                touched.has(uri.toString()),
                false,
                'the task run changed the markers on the file the lint pass had reported on'
            );
        }
    });
});
