// `phel.debugTest`: the command behind the `Debug test` CodeLens, the Phel
// menu's Debug Test entry and the Testing view's Debug profile.
//
// What it has to get right is an ordering and an environment, and both are
// observable here: a `phel` session has to be listening *before* the run
// starts, and the run has to be told to dial into that session rather than
// wherever `php.ini` points. The fixture has no `vendor/bin/phel`, so the
// terminal's process fails immediately — which is fine, because what is
// asserted is the session and the terminal it was opened with, not the run.
//
// That a breakpoint is then *hit* needs a PHP with Xdebug and a compiled
// project; `docs/debugging.md` has that as a by-hand checklist.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, fixtureUri, terminalArgs, terminalEnv, waitFor } from './helpers';

const TERMINAL_NAME = 'Phel Debug Test';

describe('debug test command', function () {
    before(async function () {
        await activateExtension();
    });

    afterEach(async function () {
        const session = vscode.debug.activeDebugSession;
        if (session) {
            await vscode.debug.stopDebugging(session);
        }
        vscode.window.terminals
            .filter((terminal) => terminal.name === TERMINAL_NAME)
            .forEach((terminal) => terminal.dispose());
    });

    it('starts a session and runs the named test against it', async function () {
        const before = new Set(vscode.window.terminals);

        await vscode.commands.executeCommand(
            'phel.debugTest',
            fixtureUri('tests', 'app', 'core_test.phel'),
            'greets-a-name'
        );

        const session = await waitFor(
            'the Phel debug session to become active',
            () => vscode.debug.activeDebugSession
        );
        assert.equal(session.type, 'phel');
        // Nothing pins a port in this fixture's launch.json — it has none — so
        // the session gets one the OS handed out, and the run is told which.
        const port = session.configuration.phpDebugPort;
        assert.equal(typeof port, 'number');
        assert.ok(port > 0, `expected a real port, got ${port}`);

        const terminal = await waitFor(`the ${TERMINAL_NAME} terminal`, () =>
            vscode.window.terminals.find((t) => t.name === TERMINAL_NAME && !before.has(t))
        );

        const env = terminalEnv(terminal);
        assert.equal(env.XDEBUG_MODE, 'debug');
        assert.equal(env.XDEBUG_SESSION, '1');
        assert.equal(env.XDEBUG_CONFIG, `client_port=${port}`);

        assert.deepEqual(terminalArgs(terminal), [
            'test',
            '--filter',
            '/^greets-a-name$/',
            'tests/app/core_test.phel',
        ]);
    });

    it('debugs the whole file when the menu passes no test name', async function () {
        const before = new Set(vscode.window.terminals);

        await vscode.commands.executeCommand(
            'phel.debugTest',
            fixtureUri('tests', 'app', 'core_test.phel')
        );

        await waitFor(
            'the Phel debug session to become active',
            () => vscode.debug.activeDebugSession
        );
        const terminal = await waitFor(`the ${TERMINAL_NAME} terminal`, () =>
            vscode.window.terminals.find((t) => t.name === TERMINAL_NAME && !before.has(t))
        );

        assert.deepEqual(terminalArgs(terminal), ['test', 'tests/app/core_test.phel']);
    });
});
