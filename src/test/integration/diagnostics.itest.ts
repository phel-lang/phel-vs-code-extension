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
            vscode.languages.getDiagnostics(main.uri).find((d) => d.code === 'phel-migration')
        );
        assert.equal(diagnostic.severity, vscode.DiagnosticSeverity.Warning);
        assert.equal(diagnostic.source, 'phel');
        assert.equal(main.getText(diagnostic.range), 'push');
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
});
