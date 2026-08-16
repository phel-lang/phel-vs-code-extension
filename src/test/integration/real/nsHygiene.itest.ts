// Namespace hygiene against a real Phel: the one place the editor-side rule and
// `phel lint`'s `phel/unused-require` can be compared on the same entry.
//
// `src/consumer.phel` requires `demo.unused-dep` and never touches it. Both
// analyzers see that, which is the point: whichever spoke last, exactly one
// finding covers the entry, and the quick fix answers either of them.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import {
    activateExtension,
    openProject,
    projectPath,
    projectUri,
    readProjectFile,
    waitFor,
} from './support';

/** What `phel lint` calls the finding, and what the editor-side one is marked with. */
const LINT_CODE = 'phel/unused-require';
const HYGIENE_CODE = 'phel-unused-require';

const ENTRY = 'demo.unused-dep';
/** A PHP boot plus a lint of one file. */
const CLI_TIMEOUT_MS = 60_000;

function diagnosticsWith(uri: vscode.Uri, code: string): vscode.Diagnostic[] {
    return vscode.languages.getDiagnostics(uri).filter((d) => d.code === code);
}

async function setDiagnosticsEnabled(enabled: boolean): Promise<void> {
    await vscode.workspace
        .getConfiguration('phel')
        .update('diagnostics.enabled', enabled, vscode.ConfigurationTarget.Global);
}

describe('namespace hygiene against a real Phel CLI', function () {
    let consumer: vscode.TextDocument;

    before(async function () {
        await activateExtension();
        consumer = await openProject('src', 'consumer.phel');
    });

    after(async function () {
        await setDiagnosticsEnabled(true);
        await vscode.window.showTextDocument(consumer, { preview: false });
        await vscode.commands.executeCommand('workbench.action.files.revert');
    });

    it('lets `phel lint` own the finding, and takes it back when the CLI is off', async function () {
        const fromLint = await waitFor(
            `a ${LINT_CODE} diagnostic on consumer.phel`,
            () => diagnosticsWith(consumer.uri, LINT_CODE)[0],
            CLI_TIMEOUT_MS
        );

        assert.equal(fromLint.severity, vscode.DiagnosticSeverity.Warning);
        assert.equal(consumer.getText(fromLint.range), ENTRY);
        // Exactly one finding covers the entry: ours stood down for the CLI's.
        assert.deepEqual(
            diagnosticsWith(consumer.uri, HYGIENE_CODE).filter(
                (d) => !!d.range.intersection(fromLint.range)
            ),
            []
        );

        // With nothing running the CLI, the editor-side rule is all there is -
        // which is the state every keystroke between two saves is in.
        await setDiagnosticsEnabled(false);
        const ours = await waitFor(
            `a ${HYGIENE_CODE} hint once the CLI is not asked`,
            () => diagnosticsWith(consumer.uri, HYGIENE_CODE)[0],
            CLI_TIMEOUT_MS
        );
        assert.equal(ours.severity, vscode.DiagnosticSeverity.Hint);
        assert.ok(ours.tags?.includes(vscode.DiagnosticTag.Unnecessary));
        assert.equal(consumer.getText(ours.range), ENTRY);

        await setDiagnosticsEnabled(true);
        await waitFor(
            'the CLI to take the finding back',
            () =>
                diagnosticsWith(consumer.uri, LINT_CODE).length > 0 &&
                diagnosticsWith(consumer.uri, HYGIENE_CODE).length === 0
                    ? true
                    : undefined,
            CLI_TIMEOUT_MS
        );
    });

    it('offers the removal quick fix on what the CLI reported', async function () {
        const fromLint = await waitFor(
            `a ${LINT_CODE} diagnostic on consumer.phel`,
            () => diagnosticsWith(consumer.uri, LINT_CODE)[0],
            CLI_TIMEOUT_MS
        );

        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
            'vscode.executeCodeActionProvider',
            consumer.uri,
            fromLint.range
        );
        const fix = actions.find((a) => a.title === `Remove unused require '${ENTRY}'`);
        assert.ok(fix, `no removal among: ${actions.map((a) => a.title).join(', ')}`);
        assert.ok(fix.edit, 'the fix carries no edit');

        assert.equal(await vscode.workspace.applyEdit(fix.edit), true);
        assert.ok(!consumer.getText().includes(ENTRY), consumer.getText());
        // `demo.strings` is still required, and `shout` still called.
        assert.match(consumer.getText(), /\(:require demo\.strings :refer \[shout\]\)/);

        await vscode.window.showTextDocument(consumer, { preview: false });
        await vscode.commands.executeCommand('workbench.action.files.revert');
    });
});

describe('Go to Test / Source File against a real Phel project', function () {
    before(async function () {
        await activateExtension();
    });

    it('scaffolds the missing test file the project’s config points at', async function () {
        await openProject('src', 'strings.phel');
        // `{ create: true }` is the argument the notification's button stands
        // in for; a headless host has nobody to press it.
        await vscode.commands.executeCommand('phel.ns.goToTest', { create: true });

        const expected = projectUri('tests', 'strings_test.phel').toString();
        await waitFor(
            `${projectPath('tests', 'strings_test.phel')} to be created and shown`,
            () =>
                vscode.window.activeTextEditor?.document.uri.toString() === expected
                    ? true
                    : undefined,
            CLI_TIMEOUT_MS
        );

        // Written to disk, not merely into a buffer, and named the way Phel's
        // own scaffolding names it: `<ns>-test` in `<name>_test.phel`.
        const written = await readProjectFile('tests', 'strings_test.phel');
        assert.match(written, /^\(ns demo\.strings-test\n/);
        assert.match(written, /\(:require phel\.test :refer \[deftest is\]\)/);
    });
});
