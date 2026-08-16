// The benchmark side of the Test Explorer, as far as a headless host can see
// it. `vscode.tests` has no API for reading another controller's items, so the
// tree `phel-benchmarks` builds cannot be asserted from here; what can is that
// the testing surface is alive in a host with this extension active, and that
// the fixture's `defbench` is discoverable through the same scan the controller
// runs — the CodeLens is the observable end of it.
//
// The fixture ships no `vendor/bin/phel`, so a benchmark run has to fail
// silently, exactly as every other CLI-backed feature does here.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, openFixture, positionOf } from './helpers';

describe('benchmarks', function () {
    let doc: vscode.TextDocument;

    before(async function () {
        await activateExtension();
        doc = await openFixture('tests', 'app', 'core_test.phel');
    });

    it('keeps the testing surface working with a second controller registered', async function () {
        // `phel-tests` and `phel-benchmarks` are two controllers over the same
        // files; a duplicate id or a controller that throws while registering
        // would take the whole Testing view down with it.
        await vscode.commands.executeCommand('testing.refreshTests');
    });

    it('finds the fixture defbench where the controller would', async function () {
        const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
            'vscode.executeCodeLensProvider',
            doc.uri
        );
        const bench = lenses.filter((lens) => lens.command?.command === 'phel.runBenchmark');

        assert.deepEqual(
            bench.map((lens) => lens.command?.arguments?.[1]),
            ['greeting']
        );
        // The item the controller creates is anchored on the name token, so the
        // scan has to report the name's own position rather than the form's.
        assert.deepEqual(bench[0].range.start, positionOf(doc, 'greeting'));
    });

    it('survives a run with no Phel CLI to run it with', async function () {
        // Nothing about a run is observable from outside the controller that
        // started it, so this only asserts that discovering the fixture,
        // spawning a `phel` that is not there and turning the empty output into
        // per-item results does not throw or hang. That is the whole path, and
        // it is the one an editor would take on a machine without Phel.
        await vscode.commands.executeCommand('testing.runAll');
    });
});
