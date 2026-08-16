// What the status bar knows about the processes behind the editor.
//
// The item itself is not readable from an extension host - `StatusBarItem` is
// write-only to everyone but the window - so the state it renders is exposed
// through `phel.status.describe`, and that is what these assert. The fixture
// has no Phel CLI, which is the point here: every subsystem has to report where
// it really is rather than where it would be with one installed.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { PhelRuntimeSnapshot } from '../../phelRuntimeState';
import { activateExtension, waitFor } from './helpers';

function describeRuntime(): Thenable<PhelRuntimeSnapshot> {
    return vscode.commands.executeCommand('phel.status.describe');
}

describe('status bar runtime state', function () {
    let folderKey: string;

    before(async function () {
        await activateExtension();
        const folder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(folder, 'the host was launched without a workspace folder');
        folderKey = folder.uri.toString();
    });

    it('answers with a record per subsystem', async function () {
        const snapshot = await describeRuntime();

        assert.deepEqual(Object.keys(snapshot).sort(), ['daemon', 'lsp', 'nrepl']);
    });

    it('files the folder daemon as off, there being no CLI to start', async function () {
        // The workspace indexer asks for a daemon per folder shortly after
        // activation; without an executable it never gets a process.
        const state = await waitFor(
            'the analysis daemon to report for the fixture folder',
            async () => (await describeRuntime()).daemon[folderKey]
        );

        assert.equal(state, 'off');
    });

    it('reports the language server as disabled while the setting is off', async function () {
        const snapshot = await describeRuntime();

        assert.equal(snapshot.lsp[folderKey], 'disabled');
    });

    it('reports the nREPL as disconnected once a connect fails', async function () {
        await vscode.commands.executeCommand('phel.nrepl.connect');

        const state = await waitFor(
            'the nREPL to report for the fixture folder',
            async () => (await describeRuntime()).nrepl[folderKey]
        );

        assert.equal(state, 'disconnected');
    });
});
