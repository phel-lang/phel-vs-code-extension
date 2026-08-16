// The two runners: `phel test` behind the Test Explorer and the test commands,
// and `phel bench` behind the benchmark controller and its CodeLens.
//
// What a run *reported* is the one thing a suite cannot see. `vscode.tests`
// exposes `createTestController` and nothing else in 1.88 — there is no results
// API, and a controller belongs to the extension that made it, so the pass /
// fail state the Explorer shows is unreachable from here. So the contract is
// split: the terminal commands are observed through the exit status of the
// process behind their terminal, and the reports the controllers parse are
// produced by the real CLI and fed to the real parsers.

import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { parseBenchTable } from '../../../phelBenchOutput';
import { parseClover } from '../../../cloverParser';
import { groupByName, parseJUnit } from '../../../junitParser';
import { runPhelCli } from '../../../phelCli';
import { coverageEnv } from '../../../phelInvocation';
import { activateExtension, projectPath, projectUri, terminalExitOf } from './support';

/** The wrapper `scripts/make-real-cli-fixture.sh` writes into the project. */
const CLI = () => projectPath('bin', 'phel');

describe('the test and benchmark runners', function () {
    before(async function () {
        await activateExtension();
    });

    it('exits 1 from the terminal `phel.runTestsInFile` opens on a failing file', async function () {
        const status = await terminalExitOf(
            'phel.runTestsInFile',
            projectUri('tests', 'failing_test.phel')
        );

        assert.equal(status.code, 1, 'a file with a failing deftest must fail the run');
    });

    it('exits 0 from the terminal `phel.runBenchmark` opens', async function () {
        const status = await terminalExitOf(
            'phel.runBenchmark',
            projectUri('tests', 'shout_bench.phel'),
            'bench-shout'
        );

        assert.equal(status.code, 0);
    });

    it('produces a JUnit report the Test Explorer’s parser reads back', async function () {
        const report = path.join(os.tmpdir(), `phel-itest-junit-${process.pid}.xml`);
        try {
            const result = await runPhelCli(
                CLI(),
                ['test', '--reporter=junit-xml', '-o', report, 'tests/failing_test.phel'],
                projectPath()
            );
            assert.equal(result.code, 1, result.stdout + result.stderr);

            const byName = groupByName(parseJUnit(await fs.readFile(report, 'utf-8')));
            const names = [...byName.values()];
            const passed = names.find((c) => c.name === 'test-shout-passes');
            const failed = names.find((c) => c.name === 'test-shout-fails');

            assert.equal(passed?.passed, true);
            assert.equal(failed?.passed, false);
            assert.equal(failed?.suite, 'demo.failing-test');
            assert.equal(failed?.failures[0].type, 'AssertionFailed');
            assert.match(failed?.failures[0].detail ?? '', /\(shout "hi"\)/);
        } finally {
            await fs.rm(report, { force: true }).catch(() => undefined);
        }
    });

    it('writes a Clover report the coverage profile’s parser reads back', async function () {
        const junit = path.join(os.tmpdir(), `phel-itest-cov-junit-${process.pid}.xml`);
        const clover = path.join(os.tmpdir(), `phel-itest-clover-${process.pid}.xml`);
        try {
            const result = await runPhelCli(
                CLI(),
                [
                    'test',
                    '--reporter=junit-xml',
                    '-o',
                    junit,
                    '--coverage=clover',
                    `--coverage-output=${clover}`,
                    'tests/main_test.phel',
                ],
                projectPath(),
                // The same environment the coverage run profile spawns with;
                // without it Xdebug records nothing on a stock `php.ini`.
                { env: coverageEnv(process.env.XDEBUG_MODE) }
            );
            if (/--coverage requires the pcov or xdebug extension/i.test(result.stdout)) {
                // Neither driver is installed: nothing to observe, and the
                // controller's own fallback covers it.
                this.skip();
            }

            const covered = parseClover(await fs.readFile(clover, 'utf-8'));
            const main = covered.find((file) => file.file.endsWith('src/main.phel'));
            assert.ok(main, `no src/main.phel among ${covered.map((c) => c.file).join(', ')}`);
            assert.ok(main.lines.length > 0);
            assert.ok(
                main.lines.some((line) => line.covered),
                'the test exercised `greet`, so some line of main.phel ran'
            );
        } finally {
            await fs.rm(junit, { force: true }).catch(() => undefined);
            await fs.rm(clover, { force: true }).catch(() => undefined);
        }
    });

    it('prints a benchmark table `parseBenchTable` reads back', async function () {
        const result = await runPhelCli(
            CLI(),
            ['bench', 'tests/shout_bench.phel', '--filter=bench-shout'],
            projectPath()
        );
        assert.equal(result.code, 0, result.stdout + result.stderr);

        const rows = parseBenchTable(result.stdout);
        assert.equal(rows.length, 1, `no table in:\n${result.stdout}`);
        assert.equal(rows[0].benchmark, 'demo.shout-bench/bench-shout');
        assert.ok(rows[0].meanNs > 0, `mean was ${rows[0].meanNs}`);
        assert.equal(rows[0].vsBaseline, 'new');
    });

    it('runs everything the Explorer discovered without throwing', async function () {
        // All this can assert is that the command reaches a run profile and
        // that neither controller rejects: see the note at the top of the file.
        await vscode.commands.executeCommand('testing.runAll');
        await vscode.commands.executeCommand('testing.showMostRecentOutput');
    });
});
