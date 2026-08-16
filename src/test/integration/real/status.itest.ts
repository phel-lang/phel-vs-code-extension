// The status bar's view of the runtime, against processes that really run.
//
// The default host can only show what "nothing installed" looks like: no
// daemon, no server, every state at rest. Here a keystroke boots a real PHP,
// `phel.nrepl.connect` opens a real socket, and the restart command really
// kills something - so this is the only place where the transitions the icons
// stand for are observed rather than assumed.
//
// The item's text is not readable from an extension host, so the state behind
// it is read through `phel.status.describe`.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { DaemonState, NreplState, PhelRuntimeSnapshot } from '../../../phelRuntimeState';
import { activateExtension, openProject, projectFolder, type, waitFor } from './support';

function describeRuntime(): Thenable<PhelRuntimeSnapshot> {
    return vscode.commands.executeCommand('phel.status.describe');
}

describe('the status bar against a real Phel', function () {
    let scratch: vscode.TextDocument;
    let folderKey: string;
    /** Distinct text per edit, so no keystroke is a no-op the daemon skips. */
    let edits = 0;

    /** The daemon state for the project folder, once there is one. */
    async function daemon(): Promise<DaemonState | undefined> {
        return (await describeRuntime()).daemon[folderKey];
    }

    async function nrepl(): Promise<NreplState | undefined> {
        return (await describeRuntime()).nrepl[folderKey];
    }

    /** Edit the scratch buffer without saving, which is what a keystroke is. */
    async function keystroke(): Promise<void> {
        await type(scratch, `\n; status suite edit ${++edits}\n`);
    }

    before(async function () {
        await activateExtension();
        folderKey = projectFolder().uri.toString();
        scratch = await openProject('src', 'scratch.phel');
    });

    it('reports the nREPL connection it opened', async function () {
        await vscode.commands.executeCommand('phel.nrepl.connect');

        const state = await waitFor(
            'the nREPL to report a live connection',
            async () => {
                const current = await nrepl();
                return current === 'connected' || current === 'attached' ? current : undefined;
            },
            60_000
        );

        // Which of the two depends on whether a server from an earlier suite is
        // still answering on `.nrepl-port`; both are a connection.
        assert.ok(['connected', 'attached'].includes(state));
    });

    it('reports the analysis daemon around a keystroke', async function () {
        await keystroke();

        const state = await waitFor(
            'the analysis daemon to have a process',
            async () => {
                const current = await daemon();
                return current === 'running' || current === 'idle' ? current : undefined;
            },
            60_000
        );

        assert.ok(['running', 'idle'].includes(state));
    });

    it('drops to off on restart, and comes back on the next keystroke', async function () {
        await vscode.commands.executeCommand('phel.diagnostics.restartDaemon');

        assert.equal(await daemon(), 'off', 'the restart left a daemon behind');

        await keystroke();
        await waitFor(
            'a fresh daemon after the restart',
            async () => {
                const current = await daemon();
                return current === 'running' || current === 'idle' ? current : undefined;
            },
            60_000
        );
    });

    it('reports the nREPL as disconnected once disconnected', async function () {
        await vscode.commands.executeCommand('phel.nrepl.disconnect');

        assert.equal(await nrepl(), 'disconnected');
    });

    after(async function () {
        await vscode.commands.executeCommand('phel.nrepl.disconnect');
        // The scratch buffer was never saved; drop the edits so the next suite
        // sees the file the fixture script wrote.
        await vscode.window.showTextDocument(scratch, { preview: false });
        await vscode.commands.executeCommand('workbench.action.files.revert');
    });
});
