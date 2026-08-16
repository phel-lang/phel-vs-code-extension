// `Phel: Show Documentation` in a real host. The panel's HTML is unit-tested;
// what only the editor can show is that the command resolves a symbol without
// a quick pick, that it opens a webview of our own view type, and that a second
// call lands in the same one rather than stacking tabs.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, waitFor } from './helpers';

const VIEW_TYPE = 'phel.docs';

/** Every open tab that hosts the docs webview. */
function docsTabs(): vscode.Tab[] {
    return vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter(
            (tab) =>
                tab.input instanceof vscode.TabInputWebview &&
                tab.input.viewType.includes(VIEW_TYPE)
        );
}

describe('the docs panel', function () {
    before(async function () {
        await activateExtension();
    });

    after(async function () {
        await vscode.window.tabGroups.close(docsTabs());
    });

    it('resolves a bare name to the symbol it showed', async function () {
        const shown = await vscode.commands.executeCommand('phel.showDoc', 'map');

        assert.deepEqual(shown, { symbol: 'phel.core/map' });
    });

    it('opens one webview, and reuses it for the next symbol', async function () {
        await vscode.commands.executeCommand('phel.showDoc', 'assoc');
        const tab = await waitFor('the docs webview to open', () => docsTabs()[0]);
        assert.equal(tab.label, 'Phel API');

        await vscode.commands.executeCommand('phel.showDoc', 'filter');

        assert.equal(docsTabs().length, 1, 'the second call opened a second panel');
    });

    it('takes a qualified name as it is', async function () {
        // Every case passes a symbol that resolves: an unknown one falls back to
        // the quick pick, which nothing in a test can answer.
        assert.deepEqual(
            await vscode.commands.executeCommand('phel.showDoc', 'phel.test/deftest'),
            {
                symbol: 'phel.test/deftest',
            }
        );
    });
});
