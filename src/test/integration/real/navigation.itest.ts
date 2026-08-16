// Go to Definition and Find All References over a real project index.
//
// Two of the three cases can only be answered by the daemon walking the project
// through PHP: a required namespace is not a symbol any parser here indexes,
// and the position the daemon reports for a definition is the name itself,
// where the TypeScript index reports the `(` that opens the form. The third —
// references — is where the two are merged.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, openProject, positionOf, typeAndSave, waitFor } from './support';

/** How long the first `indexProject` may take: a PHP boot plus a walk of the project. */
const INDEX_TIMEOUT_MS = 90_000;

describe('navigation over the daemon’s project index', function () {
    let consumer: vscode.TextDocument;
    let strings: vscode.TextDocument;

    function definitionsIn(
        doc: vscode.TextDocument,
        position: vscode.Position
    ): Thenable<vscode.Location[] | undefined> {
        return vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeDefinitionProvider',
            doc.uri,
            position
        );
    }

    before(async function () {
        await activateExtension();
        strings = await openProject('src', 'strings.phel');
        consumer = await openProject('src', 'consumer.phel');
        // The project is re-indexed 2 s after a `.phel` file is saved, which is
        // the only trigger a suite can reach; the index built at activation may
        // predate an earlier suite's edits.
        await typeAndSave(consumer, '\n; re-index, please\n');
    });

    it('goes from a required namespace to the `ns` form that declares it', async function () {
        const position = positionOf(consumer, 'demo.strings :refer', 2);
        const locations = await waitFor(
            'the project index to reach go-to-definition',
            async () => {
                const found = await definitionsIn(consumer, position);
                return found && found.length > 0 ? found : undefined;
            },
            INDEX_TIMEOUT_MS
        );

        assert.equal(locations[0].uri.toString(), strings.uri.toString());
        // `(ns demo.strings)`: the name, not the form around it.
        assert.deepEqual(
            [locations[0].range.start.line, locations[0].range.start.character],
            [0, 4]
        );
        assert.equal(locations[0].range.end.character, 16);
    });

    it('resolves a `:refer`’d symbol to the file that defines it', async function () {
        const position = positionOf(consumer, '(shout text)', 1);
        // The daemon points at `shout` in `(defn shout`; the TypeScript index
        // points at the `(`. Waiting for the former is waiting for the daemon.
        const location = await waitFor(
            'the daemon to answer resolveSymbol',
            async () => {
                const found = await definitionsIn(consumer, position);
                return found?.find((l) => l.range.start.character === 6);
            },
            INDEX_TIMEOUT_MS
        );

        assert.equal(location.uri.toString(), strings.uri.toString());
        assert.equal(location.range.start.line, positionOf(strings, '(defn shout').line);
    });

    it('finds the uses of a defn in every file that has one', async function () {
        const position = positionOf(strings, '(defn shout', 6);
        const locations = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            strings.uri,
            position
        );

        const files = new Set(locations.map((l) => l.uri.fsPath.replace(/^.*[\\/]/, '')));
        // `shout` is defined in strings.phel and called from three other files.
        for (const file of [
            'strings.phel',
            'consumer.phel',
            'failing_test.phel',
            'shout_bench.phel',
        ]) {
            assert.ok(files.has(file), `no reference in ${file}; found ${[...files].join(', ')}`);
        }
    });
});
