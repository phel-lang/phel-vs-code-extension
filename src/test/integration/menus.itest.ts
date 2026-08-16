// The commands the new context / title-run / explorer menus invoke. A menu item
// is only ever as good as the command behind it, and `phel.runFile` is the one
// this repo added for them: it takes the uri the explorer passes as its first
// argument and has to resolve *that* file's workspace folder, not the active
// editor's.
//
// The fixture has no `vendor/bin/phel`, so the terminal's shell process fails
// straight away. That is fine — what is asserted is the terminal the command
// opened and the cwd it opened it in, which is the part a wrong folder lookup
// would get wrong.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { WORKSPACE_ROOT, activateExtension, fixtureUri, waitFor } from './helpers';

const RUN_TERMINAL = 'Phel Run';

/**
 * `creationOptions` widens to `TerminalOptions | ExtensionTerminalOptions`, and
 * only the former has a `cwd` — which is then a string or a Uri, depending on
 * what the caller passed.
 */
function cwdOf(terminal: vscode.Terminal): string | undefined {
    const options = terminal.creationOptions as vscode.TerminalOptions;
    const cwd = options.cwd;
    if (cwd === undefined) {
        return undefined;
    }
    return typeof cwd === 'string' ? cwd : cwd.fsPath;
}

describe('menu commands', function () {
    before(async function () {
        await activateExtension();
    });

    it('registers the run-file command the menus point at', async function () {
        const registered = await vscode.commands.getCommands(true);
        assert.ok(registered.includes('phel.runFile'), 'phel.runFile is not registered');
    });

    it('runs the uri it is handed in a terminal rooted at that folder', async function () {
        const before = new Set(vscode.window.terminals);
        await vscode.commands.executeCommand('phel.runFile', fixtureUri('src', 'app', 'main.phel'));

        // `createTerminal` returns synchronously, but the terminal only shows up
        // in `window.terminals` once the host has caught up with the command.
        const terminal = await waitFor(`the ${RUN_TERMINAL} terminal`, () =>
            vscode.window.terminals.find((t) => t.name === RUN_TERMINAL && !before.has(t))
        );

        try {
            assert.equal(cwdOf(terminal), WORKSPACE_ROOT);
        } finally {
            terminal.dispose();
        }
    });
});
