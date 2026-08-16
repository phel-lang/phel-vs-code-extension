// Navigation served by the analysis daemon's project index: go-to-definition
// on a required namespace, and the daemon's reference sites merged into the
// ones the token scan found.
//
// Same setup as the live-diagnostics suite: the fixture has no Phel, so
// `phel.executablePath` points at `test-fixtures/bin/phel`, the shell script
// that execs the fake daemon. It answers `indexProject` with a one-symbol index
// over the fixture's own `src/app/core.phel`, so what lands in the editor is
// checkable — and it is deliberately *not* what the TypeScript index would say:
// the daemon points at the `greet` in `(defn greet`, the workspace index at the
// `(` that opens the form.
//
// `#!/bin/sh` again means the suite skips on Windows; CI runs integration on
// Linux.

import * as assert from 'node:assert/strict';
import * as path from 'path';
import * as vscode from 'vscode';
import { activateExtension, openFixture, positionOf, waitFor } from './helpers';

const SETTING = 'executablePath';

/** `test-fixtures/bin/phel`, next to the fixture workspace. */
const FAKE_CLI = path.resolve(__dirname, '../../../test-fixtures/bin/phel');

describe('navigation through the analysis daemon', function () {
    let main: vscode.TextDocument;
    let core: vscode.TextDocument;

    const config = () => vscode.workspace.getConfiguration('phel');

    function definitionsAt(position: vscode.Position): Thenable<vscode.Location[] | undefined> {
        return vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeDefinitionProvider',
            main.uri,
            position
        );
    }

    before(async function () {
        if (process.platform === 'win32') {
            this.skip();
        }
        await activateExtension();
        main = await openFixture('src', 'app', 'main.phel');
        core = await openFixture('src', 'app', 'core.phel');
        // Changing which CLI answers re-indexes the project, 2 s later.
        await config().update(SETTING, FAKE_CLI, vscode.ConfigurationTarget.Global);
    });

    after(async function () {
        if (process.platform === 'win32') {
            return;
        }
        await config().update(SETTING, undefined, vscode.ConfigurationTarget.Global);
    });

    it('goes from a required namespace to the `ns` form that declares it', async function () {
        // Nothing answers this without the daemon: a namespace is not a symbol
        // in the workspace index, so the request used to come back empty.
        const position = positionOf(main, 'app.core :refer', 2);
        const locations = await waitFor('the project index to reach go-to-definition', async () => {
            const found = await definitionsAt(position);
            return found && found.length > 0 ? found : undefined;
        });

        assert.equal(locations[0].uri.toString(), core.uri.toString());
        // `(ns app.core)`: the name, not the form.
        assert.deepEqual(
            [locations[0].range.start.line, locations[0].range.start.character],
            [0, 4]
        );
        assert.equal(locations[0].range.end.character, 12);
    });

    it('resolves a symbol through the daemon, at the position it reports', async function () {
        const position = positionOf(main, '(greet person)', 1);
        const location = await waitFor('the daemon to answer resolveSymbol', async () => {
            const found = await definitionsAt(position);
            // Until the project index is there, the workspace index answers
            // with the start of the form instead.
            return found?.find((l) => l.range.start.character === 6);
        });

        assert.equal(location.uri.toString(), core.uri.toString());
        assert.equal(location.range.start.line, positionOf(core, '(defn greet').line);
    });

    it('merges the daemon’s reference sites into the ones the scan found', async function () {
        const position = positionOf(main, '(greet person)', 1);
        const locations = await waitFor('the daemon to answer findReferences', async () => {
            const found = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                main.uri,
                position
            );
            // The `(ns app.core)` line: the fake reports it, and no token scan
            // ever would, so its presence is the daemon's answer arriving.
            return found?.some((l) => l.range.start.line === 0) ? found : undefined;
        });

        const inCore = locations.filter((l) => l.uri.toString() === core.uri.toString());
        const definitionSite = inCore.filter(
            (l) =>
                l.range.start.line === positionOf(core, '(defn greet').line &&
                l.range.start.character === 6
        );
        assert.equal(definitionSite.length, 1, 'the site both sides found is listed twice');
        assert.ok(
            locations.some((l) => l.uri.toString() === main.uri.toString()),
            'the scan’s own hits are gone'
        );
    });
});
