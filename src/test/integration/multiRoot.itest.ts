// The one thing a single-folder host cannot answer: which workspace folder does
// a file-scoped command run in? This suite runs in the second host, opened with
// `test-fixtures/multi-root.code-workspace` (see `runTests.ts`), with the active
// editor deliberately in the *first* folder while the commands are invoked on a
// file in the second one. Resolving the folder from the active editor — what the
// bench commands used to do — puts the CLI in the wrong project.
//
// The terminal is the assertion: the fixture ships no `vendor/bin/phel`, so the
// process behind it cannot start, but its `creationOptions` record the cwd and
// the argv the extension asked for.

import * as assert from 'node:assert/strict';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    WORKSPACE_ROOT,
    activateExtension,
    fixtureUri,
    openFixture,
    terminalArgs,
    terminalCwd,
    terminalShellPath,
    waitFor,
} from './helpers';

const FIXTURES = path.resolve(__dirname, '../../../test-fixtures');
/** The second folder of the workspace; the first one is `WORKSPACE_ROOT`. */
const UTIL_ROOT = path.join(FIXTURES, 'workspace2');
const STRINGS = path.join('src', 'util', 'strings.phel');

describe('multi-root workspace', function () {
    const opened: vscode.Terminal[] = [];

    before(async function () {
        await activateExtension();
        // Anchor the active editor in the first folder: every assertion below is
        // about the command ignoring it in favour of the file it was given.
        await openFixture('src', 'app', 'core.phel');
    });

    afterEach(function () {
        opened.splice(0).forEach((terminal) => terminal.dispose());
    });

    it('opens both fixture folders', function () {
        assert.deepEqual(
            (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.name),
            ['workspace', 'workspace2']
        );
    });

    it("runs a file's tests in the folder that file belongs to", async function () {
        const terminal = await runCommand('phel.runTestsInFile', vscode.Uri.file(strings()));

        assert.equal(terminalCwd(terminal), UTIL_ROOT);
        assert.deepEqual(terminalArgs(terminal), ['test', STRINGS]);
    });

    it('runs a file in the folder it belongs to', async function () {
        // The Explorer context menu passes the uri of the file that was clicked,
        // which is the case that has nothing to do with the active editor.
        const terminal = await runCommand('phel.runFile', vscode.Uri.file(strings()));

        assert.equal(terminalCwd(terminal), UTIL_ROOT);
        assert.deepEqual(terminalArgs(terminal), ['run', STRINGS]);
    });

    it("takes the CLI path from the folder's own settings", async function () {
        // `workspace2/.vscode/settings.json` sets `phel.executablePath` to
        // `tools/phel2`. VS Code only keeps a folder-level value for a setting
        // declared `"scope": "resource"`, so without that in `package.json` this
        // resolves to the default `vendor/bin/phel` instead.
        const terminal = await runCommand('phel.runTestsInFile', vscode.Uri.file(strings()));

        assert.equal(terminalShellPath(terminal), path.join(UTIL_ROOT, 'tools', 'phel2'));
    });

    it('leaves the other folder on its own CLI', async function () {
        // Same command, same window, a file in the folder that overrides
        // nothing: a folder value must not leak across the workspace.
        const terminal = await runCommand(
            'phel.runTestsInFile',
            fixtureUri('tests', 'app', 'core_test.phel')
        );

        assert.equal(
            terminalShellPath(terminal),
            path.join(WORKSPACE_ROOT, 'vendor', 'bin', 'phel')
        );
    });

    it('benchmarks in the folder that file belongs to', async function () {
        // `phel.benchFile` asks for a `--filter` through an input box that a
        // headless host has no way to answer; `phel.runBenchmark` is the same
        // code path with the name supplied by the CodeLens instead.
        const terminal = await runCommand(
            'phel.runBenchmark',
            vscode.Uri.file(strings()),
            'shouting'
        );

        assert.equal(terminalCwd(terminal), UTIL_ROOT);
        assert.deepEqual(terminalArgs(terminal), ['bench', STRINGS, '--filter=shouting']);
    });

    function strings(): string {
        return path.join(UTIL_ROOT, STRINGS);
    }

    /** Invoke `command` and return the terminal it opened. */
    async function runCommand(command: string, ...args: unknown[]): Promise<vscode.Terminal> {
        const created: vscode.Terminal[] = [];
        const subscription = vscode.window.onDidOpenTerminal((terminal) => {
            created.push(terminal);
            opened.push(terminal);
        });
        try {
            await vscode.commands.executeCommand(command, ...args);
            return await waitFor(`the terminal ${command} opens`, () => created[0]);
        } finally {
            subscription.dispose();
        }
    }
});
