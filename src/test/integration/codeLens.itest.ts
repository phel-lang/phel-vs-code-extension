// The CodeLenses a `.phel` file carries: the test / benchmark ones on a
// `deftest` file — two per `deftest` (run, debug), one per `defbench`, and the
// two file-level lenses that run all of each — and the reference count above
// every definition. The commands they carry are what the editor invokes on
// click, so they are the part worth pinning.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, openFixture, positionOf, waitFor } from './helpers';

/** Every lens the providers offer for `doc`. */
function lensesOf(doc: vscode.TextDocument): Thenable<vscode.CodeLens[]> {
    return vscode.commands.executeCommand<vscode.CodeLens[]>(
        'vscode.executeCodeLensProvider',
        doc.uri,
        10
    );
}

describe('test CodeLens', function () {
    before(async function () {
        await activateExtension();
    });

    it('offers a lens per deftest and defbench, plus the file-level ones', async function () {
        const doc = await openFixture('tests', 'app', 'core_test.phel');
        const lenses = await lensesOf(doc);

        // No reference lens among them: a `deftest` name is an entry point the
        // runner discovers, not a symbol anything calls.
        assert.deepEqual(lenses.map((lens) => lens.command?.command).sort(), [
            'phel.benchFile',
            'phel.debugTest',
            'phel.debugTest',
            'phel.runBenchmark',
            'phel.runTest',
            'phel.runTest',
            'phel.runTestsInFile',
        ]);

        for (const command of ['phel.runTest', 'phel.debugTest']) {
            const perTest = lenses.filter((lens) => lens.command?.command === command);
            assert.deepEqual(
                perTest.map((lens) => lens.command?.arguments?.[1]),
                ['greets-a-name', 'greets-an-empty-name'],
                `${command} lenses`
            );
        }
    });
});

describe('reference CodeLens', function () {
    before(async function () {
        await activateExtension();
    });

    /**
     * The reference lenses of `doc`, keyed by the symbol each one sits on. The
     * lens is anchored at the name itself, which is also where its click sends
     * the reference peek.
     */
    async function referenceLenses(doc: vscode.TextDocument): Promise<Map<string, string>> {
        const lenses = await lensesOf(doc);
        const out = new Map<string, string>();
        for (const lens of lenses) {
            if (lens.command?.command !== 'phel.showReferences') {
                continue;
            }
            const range = doc.getWordRangeAtPosition(lens.range.start, /[^\s()[\]{}"]+/);
            out.set(range ? doc.getText(range) : '', lens.command.title);
        }
        return out;
    }

    /** Everything <kbd>shift</kbd>+F12 lists for `name`, defined in `doc`. */
    function referencesTo(doc: vscode.TextDocument, name: string): Thenable<vscode.Location[]> {
        return vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            doc.uri,
            positionOf(doc, `(defn ${name}`, 6)
        );
    }

    it('counts every use of a definition across the workspace', async function () {
        const doc = await openFixture('src', 'app', 'core.phel');
        const lenses = await waitFor(
            'the workspace index to reach the reference lenses',
            async () => {
                const found = await referenceLenses(doc);
                return found.size === 2 ? found : undefined;
            }
        );

        // `old-greet`: the `:refer` in main.phel and the call under it.
        assert.equal(lenses.get('old-greet'), '2 references');
        // `greet` is used from every other file in the fixture, and how many
        // times is a number the fixture keeps growing; what has to hold is that
        // the lens counts exactly what the peek behind it lists, less the
        // definition it sits on.
        const uses = await referencesTo(doc, 'greet');
        assert.ok(uses.length > 6, `only ${uses.length} references to greet`);
        assert.equal(lenses.get('greet'), `${uses.length - 1} references`);
    });

    it('says so when nothing uses a definition', async function () {
        const doc = await openFixture('src', 'app', 'main.phel');
        const lenses = await waitFor(
            'the workspace index to reach the reference lenses',
            async () => {
                const found = await referenceLenses(doc);
                return found.size === 3 ? found : undefined;
            }
        );

        assert.deepEqual([...lenses.entries()].sort(), [
            ['add-item', 'no references'],
            ['welcome', 'no references'],
            ['welcome-legacy', 'no references'],
        ]);
    });

    it('clicks through from a position the reference provider answers on', async function () {
        const doc = await openFixture('src', 'app', 'core.phel');
        const lens = await waitFor('a reference lens on core.phel', async () => {
            const lenses = await lensesOf(doc);
            return lenses.find((l) => l.command?.command === 'phel.showReferences');
        });

        // The lens is anchored at the name, not at the `(` its form starts with,
        // which is the difference between a peek and an empty one.
        const [uri, position] = lens.command?.arguments ?? [];
        assert.equal((uri as vscode.Uri).toString(), doc.uri.toString());
        assert.equal(doc.getWordRangeAtPosition(position as vscode.Position) !== undefined, true);
        const locations = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            uri,
            position
        );
        assert.ok(locations.length > 0, 'the lens position lists no references');
    });
});
