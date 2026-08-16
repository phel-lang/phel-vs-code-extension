// Format on save, with `phel format` doing the formatting - and the on-type
// indentation, whose whole promise is that the CLI then leaves it alone.
//
// The provider round-trips the buffer through a temp file, so nothing but a
// real CLI can show that the edits it computes are the ones Phel would write.

import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { activateExtension, openProject, type, waitFor } from './support';

const MIS_INDENTED = '\n(defn wonky [y]\n(+ y\n1))\n';
/** What `phel format` makes of it: body indented two, arguments aligned. */
const FORMATTED = '(defn wonky [y]\n  (+ y\n     1))';

describe('format on save through `phel format`', function () {
    let doc: vscode.TextDocument;
    let original: string;
    /** Where a `phel format` run with no cwd of its own would leave its cache. */
    let strayCache: string;
    let strayCacheExisted = false;

    const editor = () => vscode.workspace.getConfiguration('editor');

    before(async function () {
        const extension = await activateExtension();
        strayCache = path.join(extension.extensionPath, '.phel');
        strayCacheExisted = existsSync(strayCache);
        doc = await openProject('src', 'format_me.phel');
        original = doc.getText();
        await editor().update('formatOnSave', true, vscode.ConfigurationTarget.Global);
    });

    after(async function () {
        await editor().update('formatOnSave', undefined, vscode.ConfigurationTarget.Global);
        // Put the file back the way the fixture script wrote it, on disk too.
        await replaceAll(doc, original);
        await doc.save();
    });

    it('rewrites what was typed to what `phel format` prints', async function () {
        await type(doc, MIS_INDENTED);
        assert.ok(doc.getText().includes('\n(+ y\n1))'), 'the buffer starts mis-indented');

        // `workbench.action.files.save` rather than `doc.save()`: format-on-save
        // is a save participant of the editor, and this is the path the user's
        // Ctrl+S takes.
        await vscode.window.showTextDocument(doc, { preview: false });
        await vscode.commands.executeCommand('workbench.action.files.save');

        await waitFor(
            'the buffer to hold what `phel format` printed',
            () => (doc.getText().includes(FORMATTED) ? true : undefined),
            60_000
        );
        assert.equal(doc.isDirty, false, 'the formatted buffer was not saved');
    });

    it('runs the CLI in the project, not in whatever directory the host started in', function () {
        // Phel resolves its project from the working directory and writes a
        // `.phel/` cache there. The provider passes the document's workspace
        // folder; without one, that cache lands in the extension host's cwd —
        // the repo root, under `npm run test:integration`.
        if (strayCacheExisted) {
            this.skip(); // a cache from an earlier run; nothing to conclude
        }
        assert.equal(
            existsSync(strayCache),
            false,
            `\`phel format\` ran outside the project and cached into ${strayCache}`
        );
    });
});

/** Typed one per line, unindented, the way they leave a keyboard. */
const TYPED = [
    '(defn shape [xs]',
    '(let [n (count xs)]',
    '(if (> n 1)',
    '(-> xs',
    '(first)',
    '(str "!"))',
    'nil)))',
    // The trailing newline `phel format` insists on. Nothing to indent on it,
    // which is itself worth going through the provider for.
    '',
];

describe('on-type indentation against `phel format`', function () {
    let doc: vscode.TextDocument;
    let original: string;

    const editor = () => vscode.workspace.getConfiguration('editor');

    before(async function () {
        await activateExtension();
        doc = await openProject('src', 'indent_me.phel');
        original = doc.getText();
        await editor().update('formatOnSave', true, vscode.ConfigurationTarget.Global);
    });

    after(async function () {
        await editor().update('formatOnSave', undefined, vscode.ConfigurationTarget.Global);
        await replaceAll(doc, original);
        await doc.save();
    });

    it('places every line where `phel format` would have put it', async function () {
        // What the CLI makes of those lines, from a buffer that has them all at
        // column 0. It is the yardstick for the rest of the case, and asking for
        // it first is what keeps a silent CLI from making everything below pass.
        await replaceAll(doc, original + '\n' + TYPED.join('\n'));
        const edits = await waitFor(
            '`phel format` to answer for the mis-indented body',
            async () => {
                const found = await vscode.commands.executeCommand<vscode.TextEdit[]>(
                    'vscode.executeFormatDocumentProvider',
                    doc.uri,
                    { tabSize: 2, insertSpaces: true }
                );
                return found && found.length > 0 ? found : undefined;
            },
            60_000
        );
        // VS Code hands back the minimal edits, not the whole-document replace
        // the provider computed, so the CLI's text is what applying them gives.
        const applyFormat = new vscode.WorkspaceEdit();
        applyFormat.set(doc.uri, edits);
        assert.ok(await vscode.workspace.applyEdit(applyFormat), 'could not apply the CLI edits');
        const formatted = doc.getText();

        // The same lines, typed one at a time, each placed by the on-type
        // provider alone - no CLI involved.
        await replaceAll(doc, original);
        for (const line of TYPED) {
            await typeLine(doc, line);
        }
        assert.equal(doc.getText(), formatted);

        // And through the path a user takes: save, with format-on-save on.
        await vscode.window.showTextDocument(doc, { preview: false });
        await vscode.commands.executeCommand('workbench.action.files.save');
        await waitFor('the save to finish', () => (doc.isDirty ? undefined : true), 60_000);
        assert.equal(doc.getText(), formatted, 'format-on-save moved a line the provider placed');
    });
});

/** Append `line` on a new line, then let the on-type provider indent it. */
async function typeLine(doc: vscode.TextDocument, line: string): Promise<void> {
    await type(doc, '\n' + line);
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
        'vscode.executeFormatOnTypeProvider',
        doc.uri,
        new vscode.Position(doc.lineCount - 1, 0),
        '\n',
        { tabSize: 2, insertSpaces: true }
    );
    if (!edits || edits.length === 0) {
        return;
    }
    const apply = new vscode.WorkspaceEdit();
    apply.set(doc.uri, edits);
    if (!(await vscode.workspace.applyEdit(apply))) {
        throw new Error(`could not indent line ${doc.lineCount - 1} of ${doc.uri.fsPath}`);
    }
}

async function replaceAll(doc: vscode.TextDocument, text: string): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), text);
    if (!(await vscode.workspace.applyEdit(edit))) {
        throw new Error(`could not rewrite ${doc.uri.fsPath}`);
    }
}
