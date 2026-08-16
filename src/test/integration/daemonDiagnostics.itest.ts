// Live (on-type) diagnostics end to end: a keystroke has to reach a daemon
// process and come back as a squiggle in the `phel-live` collection, and the
// restart command has to drop both the process and what it reported.
//
// The fixture has no Phel, so `phel.executablePath` is pointed at
// `test-fixtures/bin/phel` - a shell script that execs the fake daemon the
// unit suite drives. That script is `#!/bin/sh`, so the whole suite skips on
// Windows; the CI integration job runs on Linux, where it does not.

import * as assert from 'node:assert/strict';
import * as path from 'path';
import * as vscode from 'vscode';
import { activateExtension, openFixture, waitFor } from './helpers';

const SETTING = 'executablePath';

/** `test-fixtures/bin/phel`, next to the fixture workspace. */
const FAKE_CLI = path.resolve(__dirname, '../../../test-fixtures/bin/phel');

/** Code of the diagnostic the fake daemon answers `analyzeSource` with. */
const FAKE_CODE = 'FAKE001';

function liveDiagnostic(uri: vscode.Uri): vscode.Diagnostic | undefined {
    return vscode.languages.getDiagnostics(uri).find((d) => d.code === FAKE_CODE);
}

describe('live diagnostics through the analysis daemon', function () {
    let main: vscode.TextDocument;

    // `ConfigurationTarget.Global`, like the inlay-hint suite: it lands in the
    // throwaway test profile rather than in a `.vscode/settings.json` inside
    // the checked-in fixture. `resolvePhelExecutable` reads the global value
    // when there is no workspace one, which is exactly this case.
    const config = () => vscode.workspace.getConfiguration('phel');

    before(async function () {
        if (process.platform === 'win32') {
            this.skip();
        }
        await activateExtension();
        main = await openFixture('src', 'app', 'main.phel');
        await config().update(SETTING, FAKE_CLI, vscode.ConfigurationTarget.Global);
    });

    after(async function () {
        if (process.platform === 'win32') {
            return;
        }
        await config().update(SETTING, undefined, vscode.ConfigurationTarget.Global);
        await vscode.commands.executeCommand('workbench.action.files.revert');
    });

    afterEach(async function () {
        await vscode.commands.executeCommand('workbench.action.files.revert');
    });

    /** Append an inert comment: a change no bundled analyzer can complain about. */
    async function type(text: string): Promise<void> {
        const edit = new vscode.WorkspaceEdit();
        edit.insert(main.uri, new vscode.Position(main.lineCount, 0), text);
        assert.ok(await vscode.workspace.applyEdit(edit), 'the edit must apply');
    }

    it('squiggles what the daemon reports, while you type', async function () {
        await type('\n; a keystroke\n');

        // The 500 ms debounce plus a process start. Generous enough for a
        // loaded CI runner, short enough that a regression still fails.
        const diagnostic = await waitFor(
            'the live diagnostic',
            () => liveDiagnostic(main.uri),
            5000
        );
        assert.equal(diagnostic.source, 'phel');
        assert.equal(diagnostic.severity, vscode.DiagnosticSeverity.Warning);
    });

    it('drops them on Restart Analysis Daemon, and serves the next edit again', async function () {
        await type('\n; before the restart\n');
        await waitFor('the live diagnostic', () => liveDiagnostic(main.uri), 5000);

        await vscode.commands.executeCommand('phel.diagnostics.restartDaemon');
        assert.equal(liveDiagnostic(main.uri), undefined, 'the restart clears what was reported');

        await type('\n; after the restart\n');
        await waitFor('the live diagnostic again', () => liveDiagnostic(main.uri), 5000);
    });
});
