// Running tests through the live nREPL, against a real `phel nrepl` server.
//
// Two halves, because the Test Explorer's own results are unreadable from an
// extension host (`vscode.tests` has no results API — see `runners.itest.ts`).
//
// The first half opens a connection of its own, straight from `out/`, and runs
// the two `deftest`s of `tests/failing_test.phel` one at a time. That is exactly
// what the run profile does per leaf, so the summary and the report the parsers
// are handed here are the ones a real run is decided by.
//
// The second half drives the extension's own connection and asserts the
// run-on-save loop end to end: with `phel.tests.runOnSave` on, saving
// `src/strings.phel` — a file with no `deftest` of its own and no
// `tests/strings_test.phel` to map to — has to reach the one test file that
// requires it. What that run came back with is read through
// `phel.status.describe`, which is the seam the runtime-state hub exists for.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { PhelNreplConnection } from '../../../phelNreplClient';
import { parseRunTestsSummary, parseTestReport } from '../../../phelNreplTestReport';
import type { PhelRuntimeSnapshot } from '../../../phelRuntimeState';
import {
    activateExtension,
    openProject,
    projectFolder,
    projectPath,
    projectUri,
    readProjectFile,
    typeAndSave,
    waitFor,
    writeProjectFile,
} from './support';

const TEST_NS = 'demo.failing-test';

/** The client writes its server's banner here; nothing in the suite reads it. */
const SILENT = { append: (): void => undefined, appendLine: (): void => undefined };

function describeRuntime(): Thenable<PhelRuntimeSnapshot> {
    return vscode.commands.executeCommand('phel.status.describe');
}

/** 1-based line of the first line of `text`, the way a reporter counts. */
function lineOf(source: string, text: string): number {
    const index = source.indexOf(text);
    assert.notEqual(index, -1, `no ${text} in the fixture`);
    return source.slice(0, index).split('\n').length;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

describe('running tests over a live nREPL', function () {
    let conn: PhelNreplConnection | undefined;
    let strings: vscode.TextDocument;
    let originalStrings: string;
    let testSource: string;

    before(async function () {
        await activateExtension();
        testSource = await readProjectFile('tests', 'failing_test.phel');
        originalStrings = await readProjectFile('src', 'strings.phel');
        conn = await PhelNreplConnection.connect(
            projectFolder(),
            SILENT,
            projectPath('bin', 'phel')
        );
    });

    after(async function () {
        await vscode.workspace
            .getConfiguration('phel')
            .update('tests.runOnSave', undefined, vscode.ConfigurationTarget.Global);
        await vscode.commands.executeCommand('phel.nrepl.disconnect');
        conn?.dispose();
        // The save below is the point of the second half; put the file back the
        // way the fixture script wrote it for the suites that come after.
        await writeProjectFile(originalStrings, 'src', 'strings.phel');
        if (strings) {
            await vscode.window.showTextDocument(strings, { preview: false });
            await vscode.commands.executeCommand('workbench.action.files.revert');
        }
    });

    it('answers a failing test with a summary and a located diff', async function () {
        const result = await conn!.runTests(TEST_NS, 'test-shout-fails');

        assert.deepEqual(parseRunTestsSummary(result.values.join('\n')), {
            pass: 0,
            fail: 1,
            error: 0,
        });

        const failures = parseTestReport(result.out);
        assert.equal(failures.length, 1, result.out);
        assert.equal(failures[0].kind, 'FAIL');
        assert.equal(failures[0].testName, 'test-shout-fails');
        assert.equal(failures[0].expected, '"this will never match"');
        assert.equal(failures[0].actual, '"HI!"');
        assert.equal(failures[0].file, 'failing_test.phel');
        // The reporter locates an assertion at the `(deftest …)` it is in, not
        // at the `(is …)` itself: the forms the macro rebuilds inherit the
        // enclosing form's location. The `(is …)` is the line after it.
        const deftestLine = lineOf(testSource, '(deftest test-shout-fails');
        assert.equal(failures[0].line, deftestLine);
        assert.equal(
            lineOf(testSource, '(is (= "this will never match"'),
            deftestLine + 1,
            'the fixture no longer has the assertion right below its deftest'
        );
    });

    it('answers a passing test with a pass and nothing to report', async function () {
        const result = await conn!.runTests(TEST_NS, 'test-shout-passes');

        assert.deepEqual(parseRunTestsSummary(result.values.join('\n')), {
            pass: 1,
            fail: 0,
            error: 0,
        });
        assert.deepEqual(parseTestReport(result.out), []);
    });

    it('re-runs the tests that require a file when it is saved', async function () {
        await vscode.workspace
            .getConfiguration('phel')
            .update('tests.runOnSave', true, vscode.ConfigurationTarget.Global);

        strings = await openProject('src', 'strings.phel');
        await vscode.commands.executeCommand('phel.nrepl.connect');
        const folderKey = projectFolder().uri.toString();
        await waitFor(
            'the extension to report a live nREPL connection',
            async () => {
                const state = (await describeRuntime()).nrepl[folderKey];
                return state === 'connected' || state === 'attached' ? state : undefined;
            },
            60_000
        );

        // Which of the three rules has to fire: `src/strings.phel` has no
        // `deftest` of its own, and the `tests/strings_test.phel` its namespace
        // maps to does not exist — so it is the third, "every test file that
        // requires `demo.strings`", and `tests/failing_test.phel` is the one.
        assert.equal(
            await exists(projectUri('tests', 'strings_test.phel')),
            false,
            'a strings_test.phel would make this a test of the second rule'
        );

        await typeAndSave(strings, '\n; touched by the run-on-save suite\n');

        const run = await waitFor(
            'the save to run the tests that require demo.strings',
            async () => {
                const last = (await describeRuntime()).lastTestRun;
                return last?.ns === TEST_NS ? last : undefined;
            },
            60_000
        );

        assert.equal(run.via, 'nrepl');
        assert.equal(run.count, 2, 'both deftests of the file should have run');
        assert.equal(run.pass, 1);
        assert.equal(run.fail, 1);
        assert.equal(run.error, 0);
    });
});
