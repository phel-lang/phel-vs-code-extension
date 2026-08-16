// `phel.debugTest` against a real Phel CLI.
//
// What this proves is the **wiring**, not a breakpoint hit: that the command
// opens a `phel` debug session, that the run it starts is a real `phel test`
// against the fixture project, and that the run finishes (exit 0 for a passing
// deftest) with the debugger's environment applied — i.e. `XDEBUG_MODE=debug`
// and a `client_port` pointing at the session does not break, hang or slow the
// run into a timeout.
//
// Whether Xdebug actually connects depends on the PHP on this machine. When it
// does, the session sees the connection and the run still exits 0, since
// nothing here sets a breakpoint; when it does not (no Xdebug in `php -v`), the
// run is an ordinary one. Both are green, and neither says anything about a
// breakpoint stopping execution — that needs a compiled project and a human,
// and is the checklist at the end of `docs/debugging.md`.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, projectUri, waitFor } from './support';

const TERMINAL_NAME = 'Phel Debug Test';

describe('debug test against a real Phel CLI', function () {
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

    it('runs a passing deftest to completion against a listening session', async function () {
        const opened: vscode.Terminal[] = [];
        let closed: vscode.Terminal | undefined;
        const subscriptions = [
            vscode.window.onDidOpenTerminal((terminal) => {
                if (terminal.name === TERMINAL_NAME) {
                    opened.push(terminal);
                }
            }),
            vscode.window.onDidCloseTerminal((terminal) => {
                if (opened.includes(terminal)) {
                    closed = terminal;
                }
            }),
        ];

        try {
            await vscode.commands.executeCommand(
                'phel.debugTest',
                projectUri('tests', 'failing_test.phel'),
                'test-shout-passes'
            );

            const session = await waitFor(
                'the Phel debug session to become active',
                () => vscode.debug.activeDebugSession
            );
            assert.equal(session.type, 'phel');
            assert.equal(typeof session.configuration.phpDebugPort, 'number');

            await waitFor(`the ${TERMINAL_NAME} terminal`, () => opened[0]);
            const terminal = await waitFor(
                `the ${TERMINAL_NAME} terminal to exit`,
                () => closed,
                90_000
            );
            const status = await waitFor(
                'the exit status of the debugged test run',
                () => terminal.exitStatus ?? undefined
            );

            // The named deftest passes, so the run exits 0 — under a debugger
            // that has nothing to stop it, as it would without one.
            assert.equal(status.code, 0);
            // The session outlives the run: it goes on listening until it is
            // stopped, which is what makes a second run debuggable too.
            assert.equal(vscode.debug.activeDebugSession?.type, 'phel');
        } finally {
            subscriptions.forEach((subscription) => subscription.dispose());
        }
    });
});
