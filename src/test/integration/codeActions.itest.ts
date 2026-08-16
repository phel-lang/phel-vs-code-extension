// The migration quick fix, end to end: the lightbulb offers it, and applying
// the edit through `workspace.applyEdit` actually rewrites the buffer. The
// pure rewrite is unit-tested; what is only visible here is that the action
// carries a `WorkspaceEdit` the editor accepts.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, openFixture, positionOf } from './helpers';

describe('code actions', function () {
    let main: vscode.TextDocument;
    let original: string;

    before(async function () {
        await activateExtension();
        main = await openFixture('src', 'app', 'main.phel');
        original = main.getText();
    });

    afterEach(async function () {
        // The edits land in the buffer and are never saved, so reverting to
        // what is on disk leaves the fixture — and the dirty flag — as found.
        await vscode.window.showTextDocument(main, { preview: false });
        await vscode.commands.executeCommand('workbench.action.files.revert');
        assert.equal(main.getText(), original);
    });

    it('offers the push -> conj rewrite and applies it', async function () {
        const position = positionOf(main, '(push xs item)', 1);
        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
            'vscode.executeCodeActionProvider',
            main.uri,
            new vscode.Range(position, position)
        );

        const fix = actions.find((a) => a.title === "Replace 'push' with 'conj'");
        assert.ok(fix, `no push -> conj fix among: ${actions.map((a) => a.title).join(', ')}`);
        assert.equal(fix.kind?.value, vscode.CodeActionKind.QuickFix.value);
        assert.ok(fix.edit, 'the fix carries no edit');

        assert.equal(await vscode.workspace.applyEdit(fix.edit), true);
        assert.ok(main.getText().includes('(conj xs item)'), 'the buffer still reads `push`');
    });
});
