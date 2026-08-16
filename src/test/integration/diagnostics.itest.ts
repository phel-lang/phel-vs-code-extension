// The two diagnostic collections the bundled providers own, plus the case that
// matters most for a user who has not installed Phel yet: the fixture has no
// `vendor/bin/phel`, so every CLI-backed feature must fail silently. That is
// the assertion, not a caveat — a spawn error surfacing as a diagnostic or an
// error notification would be a bug.

import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { WORKSPACE_ROOT, activateExtension, delay, openFixture, waitFor } from './helpers';

describe('diagnostics', function () {
    let main: vscode.TextDocument;

    before(async function () {
        await activateExtension();
        main = await openFixture('src', 'app', 'main.phel');
    });

    it('fades a local that is bound but never read', async function () {
        const diagnostic = await waitFor('the unused-local hint', () =>
            vscode.languages
                .getDiagnostics(main.uri)
                .find((d) => d.tags?.includes(vscode.DiagnosticTag.Unnecessary))
        );
        assert.equal(diagnostic.severity, vscode.DiagnosticSeverity.Hint);
        assert.equal(main.getText(diagnostic.range), 'unused-total');
    });

    it('warns about a core name Phel 0.50 removed', async function () {
        const diagnostic = await waitFor('the migration warning', () =>
            migrationDiagnosticOn(main, 'push')
        );
        assert.equal(diagnostic.severity, vscode.DiagnosticSeverity.Warning);
        assert.equal(diagnostic.source, 'phel');
    });

    it('keeps a call to a :deprecated definition a hint when the CLI cannot be asked', async function () {
        // Severity follows the project's `warn-deprecations`, which is read
        // from the Phel CLI — absent here, so the pre-existing hint stands.
        const diagnostic = await waitFor('the deprecated-call hint', () =>
            migrationDiagnosticOn(main, 'old-greet')
        );
        assert.equal(diagnostic.severity, vscode.DiagnosticSeverity.Hint);
        assert.ok(
            diagnostic.tags?.includes(vscode.DiagnosticTag.Deprecated),
            'the deprecated call is not struck through'
        );
    });

    it('says nothing about a clean file when there is no Phel CLI', async function () {
        assert.equal(
            fs.existsSync(path.join(WORKSPACE_ROOT, 'vendor', 'bin', 'phel')),
            false,
            'the fixture must not ship a Phel CLI'
        );

        const core = await openFixture('src', 'app', 'core.phel');
        // `main.phel` already has its diagnostics, so the analyzers have run at
        // least once; the CLI collection has no completion event to wait on, so
        // require silence to hold rather than merely to be true right now.
        await waitFor('the analyzers to have run at least once', () =>
            vscode.languages.getDiagnostics(main.uri).length > 0 ? true : undefined
        );
        for (let i = 0; i < 10; i++) {
            assert.deepEqual(vscode.languages.getDiagnostics(core.uri), []);
            await delay(150);
        }
    });

    it('stays silent while typing, with no daemon to analyse with either', async function () {
        // The live pass fires 500 ms after a change and spawns `phel
        // api-daemon`. There is no `phel` here, so the spawn fails - and has
        // to fail into nothing: no squiggle, no notification, no throw.
        const core = await openFixture('src', 'app', 'core.phel');
        const edit = new vscode.WorkspaceEdit();
        edit.insert(core.uri, new vscode.Position(core.lineCount, 0), '\n; typed\n');
        assert.ok(await vscode.workspace.applyEdit(edit), 'the edit must apply');

        try {
            for (let i = 0; i < 10; i++) {
                assert.deepEqual(vscode.languages.getDiagnostics(core.uri), []);
                await delay(150);
            }
        } finally {
            await vscode.commands.executeCommand('workbench.action.files.revert');
        }
    });
});

/** The migration diagnostic covering `text`, addressed by what it flagged. */
function migrationDiagnosticOn(
    doc: vscode.TextDocument,
    text: string
): vscode.Diagnostic | undefined {
    return vscode.languages
        .getDiagnostics(doc.uri)
        .find((d) => d.code === 'phel-migration' && doc.getText(d.range) === text);
}
