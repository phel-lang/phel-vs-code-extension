// The project-configuration reader in the situation the fixture reproduces: a
// real `phel-config.php`, and no `vendor/bin/phel` able to tell us what it
// evaluates to. Everything downstream of it has to answer "unknown" and keep
// going, so `null` — not a throw, not a guess — is the assertion.

import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { PhelProjectConfigProvider } from '../../phelProjectConfigProvider';
import { WORKSPACE_ROOT, activateExtension, fixtureUri } from './helpers';

describe('project configuration', function () {
    let folder: vscode.WorkspaceFolder;

    before(async function () {
        await activateExtension();
        const found = vscode.workspace.getWorkspaceFolder(fixtureUri('src', 'app', 'main.phel'));
        assert.ok(found, 'the fixture workspace folder is not open');
        folder = found;
    });

    it('answers null for a project whose config it cannot execute', async function () {
        assert.equal(
            fs.existsSync(path.join(WORKSPACE_ROOT, 'phel-config.php')),
            true,
            'the fixture must ship a phel-config.php'
        );

        const provider = new PhelProjectConfigProvider();
        try {
            assert.equal(await provider.get(folder), null);
            // Cached, so the next reader does not spawn PHP again.
            assert.equal(provider.peek(folder), null);
            assert.deepEqual(await provider.srcDirs(folder), []);
            assert.deepEqual(await provider.testDirs(folder), []);
        } finally {
            provider.dispose();
        }
    });

    it('knows nothing before the first read', function () {
        const provider = new PhelProjectConfigProvider();
        try {
            assert.equal(provider.peek(folder), undefined);
        } finally {
            provider.dispose();
        }
    });

    it('reports the missing CLI through phel.showConfig without throwing', async function () {
        // The command warns and writes to its output channel; what matters here
        // is that a failed spawn never surfaces as an unhandled rejection.
        await vscode.commands.executeCommand('phel.showConfig');
    });
});
