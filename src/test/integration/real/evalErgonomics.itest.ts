// The evaluation commands that write into the buffer, against a real nREPL.
//
// Unlike the inline decoration, these leave something a test can read: the
// comment under the form, the value in place of the form, and the read-only
// `phel-result:` document. All three need a runtime that really computes — a
// fake server would only prove the plumbing echoes what it was handed — so the
// values asserted here (`3`, `"ab"`) are Phel's own printer talking.
//
// `"ab"` and not `ab`: the nREPL server prints readably (`Printer::readable()`),
// so a string comes back with its quotes, and that is what lands in the buffer.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { NreplState, PhelRuntimeSnapshot } from '../../../phelRuntimeState';
import {
    activateExtension,
    openProject,
    positionOf,
    projectFolder,
    type,
    waitFor,
} from './support';

/** Scheme of the document `phel.nrepl.showResult` opens. */
const RESULT_SCHEME = 'phel-result';

function occurrences(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
}

describe('evaluating into the buffer against a real Phel', function () {
    let scratch: vscode.TextDocument;
    let editor: vscode.TextEditor;

    /** Show the scratch buffer and put the cursor inside `form`. */
    async function cursorIn(form: string): Promise<void> {
        editor = await vscode.window.showTextDocument(scratch, { preview: false });
        const at = positionOf(scratch, form, 2);
        editor.selection = new vscode.Selection(at, at);
    }

    before(async function () {
        await activateExtension();
        scratch = await openProject('src', 'scratch.phel');

        const folderKey = projectFolder().uri.toString();
        await vscode.commands.executeCommand('phel.nrepl.connect');
        await waitFor(
            'the nREPL to report a live connection',
            async () => {
                const snapshot: PhelRuntimeSnapshot =
                    await vscode.commands.executeCommand('phel.status.describe');
                const state: NreplState | undefined = snapshot.nrepl[folderKey];
                return state === 'connected' || state === 'attached' ? state : undefined;
            },
            60_000
        );
    });

    after(async function () {
        await vscode.commands.executeCommand('phel.nrepl.disconnect');
        // Nothing here was saved; drop the edits so the next suite sees the file
        // the fixture script wrote.
        await vscode.window.showTextDocument(scratch, { preview: false });
        await vscode.commands.executeCommand('workbench.action.files.revert');
    });

    it('writes the value under the form as a `;; =>` comment', async function () {
        await type(scratch, '\n(+ 1 2)\n');
        await cursorIn('(+ 1 2)');

        await vscode.commands.executeCommand('phel.nrepl.evalToComment');

        await waitFor(
            'the result comment under the form',
            () => (scratch.getText().includes('(+ 1 2)\n;; => 3') ? true : undefined),
            60_000
        );
    });

    it('updates that comment in place when the form is evaluated again', async function () {
        await cursorIn('(+ 1 2)');

        await vscode.commands.executeCommand('phel.nrepl.evalToComment');

        assert.equal(
            occurrences(scratch.getText(), ';; => 3'),
            1,
            're-evaluating stacked a second result comment'
        );
    });

    it('replaces the form with what it evaluated to', async function () {
        await type(scratch, '\n(str "a" "b")\n');
        await cursorIn('(str "a" "b")');

        await vscode.commands.executeCommand('phel.nrepl.evalAndReplace');

        await waitFor(
            'the form to be replaced by its value',
            () => (scratch.getText().includes('\n"ab"\n') ? true : undefined),
            60_000
        );
        assert.equal(
            scratch.getText().includes('(str "a" "b")'),
            false,
            'the form is still there next to its value'
        );
    });

    it('shows the last value in a read-only document beside the editor', async function () {
        await vscode.commands.executeCommand('phel.nrepl.showResult');

        const shown = await waitFor('the result document', () =>
            vscode.window.visibleTextEditors.find((e) => e.document.uri.scheme === RESULT_SCHEME)
        );

        assert.equal(shown.document.getText(), '"ab"');
        assert.equal(shown.document.languageId, 'phel');
    });

    it('registers the REPL history picker', async function () {
        const registered = await vscode.commands.getCommands(true);
        assert.ok(registered.includes('phel.repl.history'), 'phel.repl.history is not registered');
    });
});
