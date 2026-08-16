// Format on save, with `phel format` doing the formatting.
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
        const edit = new vscode.WorkspaceEdit();
        edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), original);
        await vscode.workspace.applyEdit(edit);
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
