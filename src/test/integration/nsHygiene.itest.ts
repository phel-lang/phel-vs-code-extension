// Namespace hygiene, through the editor rather than through the analyzer:
// the hint reaches a `.phel` buffer, the quick fix carries an edit VS Code
// accepts, the sort is offered under the kind `codeActionsOnSave` asks for,
// a new empty file gets its `(ns …)`, and the go-to-test command opens a file.
//
// The fixture has no Phel CLI, so `phel lint` never runs here and nothing
// supersedes the hint - which is exactly the state the hint exists for.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, fixtureUri, openFixture, positionOf, waitFor } from './helpers';

/** What the ns-hygiene collection marks its findings with. */
const HYGIENE_CODE = 'phel-unused-require';

function hygieneDiagnostics(uri: vscode.Uri): vscode.Diagnostic[] {
    return vscode.languages.getDiagnostics(uri).filter((d) => d.code === HYGIENE_CODE);
}

function codeActionsAt(
    doc: vscode.TextDocument,
    range: vscode.Range,
    kind?: vscode.CodeActionKind
): Thenable<vscode.CodeAction[]> {
    return vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        doc.uri,
        range,
        kind?.value
    );
}

describe('namespace hygiene', function () {
    let hygiene: vscode.TextDocument;
    let original: string;

    before(async function () {
        await activateExtension();
        hygiene = await openFixture('src', 'app', 'hygiene.phel');
        original = hygiene.getText();
    });

    afterEach(async function () {
        // Every edit here lands in the buffer and is never saved; reverting
        // leaves the checked-in fixture, and the dirty flag, as found.
        await vscode.window.showTextDocument(hygiene, { preview: false });
        await vscode.commands.executeCommand('workbench.action.files.revert');
        assert.equal(hygiene.getText(), original);
    });

    it('fades the require nothing in the file uses', async function () {
        const diagnostic = await waitFor(
            'the unused-require hint',
            () => hygieneDiagnostics(hygiene.uri)[0]
        );

        assert.equal(diagnostic.severity, vscode.DiagnosticSeverity.Hint);
        assert.ok(
            diagnostic.tags?.includes(vscode.DiagnosticTag.Unnecessary),
            'the unused require is not faded'
        );
        assert.equal(hygiene.getText(diagnostic.range), 'phel.test :refer [deftest is]');
        assert.match(diagnostic.message, /'phel\.test' is required but never used/);
        // The require that *is* used gets nothing.
        assert.equal(hygieneDiagnostics(hygiene.uri).length, 1);
    });

    it('offers the removal quick fix and applies it', async function () {
        const position = positionOf(hygiene, 'phel.test :refer');
        const actions = await codeActionsAt(hygiene, new vscode.Range(position, position));

        const fix = actions.find((a) => a.title === "Remove unused require 'phel.test'");
        assert.ok(fix, `no removal among: ${actions.map((a) => a.title).join(', ')}`);
        assert.equal(fix.kind?.value, vscode.CodeActionKind.QuickFix.value);
        assert.ok(fix.edit, 'the fix carries no edit');

        assert.equal(await vscode.workspace.applyEdit(fix.edit), true);
        assert.equal(
            hygiene.getText(),
            `(ns app.hygiene
  (:require app.core :refer [greet]))

(defn shout
  "Greets \`name\` loudly. Nothing here uses \`phel.test\`, which is the point."
  [name]
  (str (greet name) "!!"))
`
        );
    });

    it('offers the sort under the kind codeActionsOnSave asks for', async function () {
        const start = new vscode.Position(0, 0);
        const actions = await codeActionsAt(
            hygiene,
            new vscode.Range(start, start),
            vscode.CodeActionKind.SourceOrganizeImports
        );

        const sort = actions.find((a) => a.title === 'Sort requires');
        assert.ok(sort, `no sort among: ${actions.map((a) => a.title).join(', ')}`);
        assert.ok(sort.edit, 'the sort carries no edit');

        assert.equal(await vscode.workspace.applyEdit(sort.edit), true);
        assert.ok(
            hygiene
                .getText()
                .startsWith(
                    '(ns app.hygiene\n  (:require app.core :refer [greet])\n  (:require phel.test'
                ),
            hygiene.getText()
        );
    });
});

describe('the (ns …) form of a new file', function () {
    const fresh = fixtureUri('src', 'app', 'fresh.phel');

    before(async function () {
        await activateExtension();
    });

    after(async function () {
        // The buffer is dirty (nothing saved it), so drop the edits before
        // removing the file the fixture must not keep.
        const doc = vscode.workspace.textDocuments.find(
            (d) => d.uri.toString() === fresh.toString()
        );
        if (doc) {
            await vscode.window.showTextDocument(doc, { preview: false });
            await vscode.commands.executeCommand('workbench.action.files.revert');
        }
        await vscode.workspace.fs.delete(fresh).then(undefined, () => undefined);
    });

    it('is derived from how the neighbouring files map their own paths', async function () {
        const create = new vscode.WorkspaceEdit();
        create.createFile(fresh, { overwrite: true });
        assert.equal(await vscode.workspace.applyEdit(create), true);

        const doc = await vscode.workspace.openTextDocument(fresh);
        await waitFor('the derived (ns …) form', () =>
            doc.getText().length > 0 ? doc.getText() : undefined
        );

        // `src/app/core.phel` declares `app.core`, so `src` maps to no prefix.
        assert.equal(doc.getText(), '(ns app.fresh)\n\n');
    });
});

describe('Go to Test / Source File', function () {
    before(async function () {
        await activateExtension();
    });

    it('opens the test file that belongs to the source file', async function () {
        await openFixture('src', 'app', 'core.phel');
        await vscode.commands.executeCommand('phel.ns.goToTest');

        const expected = fixtureUri('tests', 'app', 'core_test.phel').toString();
        const editor = await waitFor('tests/app/core_test.phel to be shown', () =>
            vscode.window.activeTextEditor?.document.uri.toString() === expected
                ? vscode.window.activeTextEditor
                : undefined
        );
        assert.match(editor.document.getText(), /\(ns app\.core-test/);
    });

    it('walks back from the test file to the source file', async function () {
        await openFixture('tests', 'app', 'core_test.phel');
        await vscode.commands.executeCommand('phel.ns.goToTest');

        const expected = fixtureUri('src', 'app', 'core.phel').toString();
        await waitFor('src/app/core.phel to be shown', () =>
            vscode.window.activeTextEditor?.document.uri.toString() === expected ? true : undefined
        );
    });
});
