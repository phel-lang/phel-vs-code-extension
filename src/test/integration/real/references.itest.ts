// Reference counts and rename over a real project, where the same function is
// reached three ways: defined in `demo.strings`, `:refer`'d into two files and
// a test, and called through an `:as` alias in a fourth.
//
// The alias is the case worth a real project: `s/shout` is one token, so a scan
// for `shout` cannot see it, and the analysis daemon — which does index it —
// reports where the token *starts* and nothing about how long it is. Getting
// either half wrong shows up as a count that is one short, or as a rename that
// rewrites `s/shout` into `yell` and takes the alias with it.

import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { activateExtension, openProject, positionOf, waitFor } from './support';

/** Mentions of `shout` outside its own definition; see the suite header. */
const EXPECTED_REFERENCES = 8;

/** The text `edit` would leave in `doc`, without touching the file. */
function applied(doc: vscode.TextDocument, edit: vscode.WorkspaceEdit): string {
    const changes = [...edit.get(doc.uri)].sort(
        (a, b) => doc.offsetAt(b.range.start) - doc.offsetAt(a.range.start)
    );
    let text = doc.getText();
    for (const change of changes) {
        text =
            text.slice(0, doc.offsetAt(change.range.start)) +
            change.newText +
            text.slice(doc.offsetAt(change.range.end));
    }
    return text;
}

describe('reference counts and rename over a real project', function () {
    let strings: vscode.TextDocument;
    let consumer: vscode.TextDocument;
    let qualified: vscode.TextDocument;
    /** The `shout` of `(defn shout`, which every case here starts from. */
    let definition: vscode.Position;

    before(async function () {
        await activateExtension();
        strings = await openProject('src', 'strings.phel');
        consumer = await openProject('src', 'consumer.phel');
        qualified = await openProject('src', 'qualified_consumer.phel');
        definition = positionOf(strings, '(defn shout', 6);
    });

    it('counts every use of a defn, the alias-qualified one included', async function () {
        // The count comes from the workspace index, so this waits on the scan of
        // the project rather than on the daemon; the title is what it settles on.
        const title = await waitFor(
            'the reference lens on `shout` to see every file',
            async () => {
                const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
                    'vscode.executeCodeLensProvider',
                    strings.uri,
                    10
                );
                const found = lenses.find((lens) => lens.command?.command === 'phel.showReferences')
                    ?.command?.title;
                if (found !== `${EXPECTED_REFERENCES} references`) {
                    throw new Error(`the lens says ${JSON.stringify(found)}`);
                }
                return found;
            },
            60_000
        );

        assert.equal(title, `${EXPECTED_REFERENCES} references`);
    });

    it('lists those uses, plus the definition, in every file that has one', async function () {
        const locations = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            strings.uri,
            definition
        );

        // What the lens counts, plus the definition the lens sits on.
        assert.equal(locations.length, EXPECTED_REFERENCES + 1);
        assert.deepEqual([...new Set(locations.map((l) => path.basename(l.uri.fsPath)))].sort(), [
            'consumer.phel',
            'failing_test.phel',
            'qualified_consumer.phel',
            'shout_bench.phel',
            'strings.phel',
        ]);

        // The alias-qualified site is spanned whole, `s/` and all: half a token
        // is what a rename would then rewrite.
        const site = locations.find((l) => l.uri.toString() === qualified.uri.toString());
        assert.ok(site, 'no reference in qualified_consumer.phel');
        assert.equal(qualified.getText(site.range), 's/shout');
    });

    it('renames the definition and every use, keeping the alias intact', async function () {
        const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
            'vscode.executeDocumentRenameProvider',
            strings.uri,
            definition,
            'yell'
        );
        assert.ok(edit, 'the rename provider produced no edit');

        assert.match(applied(strings, edit), /\(defn yell/);
        // The `:refer`'d use, and the call under it.
        assert.match(applied(consumer, edit), /:refer \[yell\]/);
        assert.match(applied(consumer, edit), /\(yell text\)/);

        // Only the name half of `s/shout` is rewritten: the alias is this file's
        // own, and the `:require` that declares it is left alone.
        const renamed = applied(qualified, edit);
        assert.match(renamed, /\(s\/yell text\)/);
        assert.match(renamed, /:require demo\.strings :as s/);
        assert.equal(renamed.includes('shout'), false);
    });
});
