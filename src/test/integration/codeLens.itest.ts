// The test / benchmark CodeLenses on a real `deftest` file: one lens per
// `deftest`, one per `defbench`, and the two file-level lenses that run all of
// each. The commands they carry are what the editor invokes on click, so they
// are the part worth pinning.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, openFixture } from './helpers';

describe('test CodeLens', function () {
    before(async function () {
        await activateExtension();
    });

    it('offers a lens per deftest and defbench, plus the file-level ones', async function () {
        const doc = await openFixture('tests', 'app', 'core_test.phel');
        const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
            'vscode.executeCodeLensProvider',
            doc.uri,
            10
        );

        assert.deepEqual(lenses.map((lens) => lens.command?.command).sort(), [
            'phel.benchFile',
            'phel.runBenchmark',
            'phel.runTest',
            'phel.runTest',
            'phel.runTestsInFile',
        ]);

        const runTest = lenses.filter((lens) => lens.command?.command === 'phel.runTest');
        assert.deepEqual(
            runTest.map((lens) => lens.command?.arguments?.[1]),
            ['greets-a-name', 'greets-an-empty-name']
        );
    });
});
