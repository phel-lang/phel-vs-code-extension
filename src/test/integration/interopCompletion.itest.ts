// PHP-interop completion end to end: what the daemon answers has to reach the
// popup *next to* what the bundled provider offers, not instead of it.
//
// The two providers are registered separately and VS Code merges them, which is
// exactly the thing a unit test cannot show. The fixture has no Phel, so
// `phel.executablePath` points at `test-fixtures/bin/phel` - the shell script
// that execs the fake daemon - and the whole suite skips on Windows with it.

import * as assert from 'node:assert/strict';
import * as path from 'path';
import * as vscode from 'vscode';
import { activateExtension, labelOf, openFixture, waitFor } from './helpers';

const SETTING = 'executablePath';
const INTEROP_SETTING = 'completion.phpInterop';

/** `test-fixtures/bin/phel`, next to the fixture workspace. */
const FAKE_CLI = path.resolve(__dirname, '../../../test-fixtures/bin/phel');

/** A PHP global function; only the daemon can know of it. */
const PHP_FN = 'strtoupper';

/** A `phel.core` function; only the bundled provider offers it. */
const CORE_FN = 'map';

describe('PHP-interop completion through the analysis daemon', function () {
    let main: vscode.TextDocument;

    const config = () => vscode.workspace.getConfiguration('phel');

    /** Append `(php/str` and answer with the position right after it. */
    async function typeInteropPosition(): Promise<vscode.Position> {
        const typed = '\n(php/str';
        const edit = new vscode.WorkspaceEdit();
        edit.insert(main.uri, new vscode.Position(main.lineCount, 0), typed);
        assert.ok(await vscode.workspace.applyEdit(edit), 'the edit must apply');
        // Addressed by the text rather than by line/column: where an insert at
        // the end of the buffer lands depends on the fixture's last line.
        return main.positionAt(main.getText().lastIndexOf(typed) + typed.length);
    }

    function completionsAt(position: vscode.Position): Thenable<vscode.CompletionList | undefined> {
        return vscode.commands.executeCommand<vscode.CompletionList>(
            'vscode.executeCompletionItemProvider',
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
        await config().update(SETTING, FAKE_CLI, vscode.ConfigurationTarget.Global);
    });

    after(async function () {
        if (process.platform === 'win32') {
            return;
        }
        await config().update(SETTING, undefined, vscode.ConfigurationTarget.Global);
        await config().update(INTEROP_SETTING, undefined, vscode.ConfigurationTarget.Global);
        await vscode.commands.executeCommand('workbench.action.files.revert');
    });

    afterEach(async function () {
        await vscode.commands.executeCommand('workbench.action.files.revert');
    });

    it('merges the daemon’s PHP symbols into the bundled list', async function () {
        const position = await typeInteropPosition();

        // The first request pays for starting the daemon, and only what
        // arrives within 400 ms is shown - so ask until it is warm.
        const items = await waitFor(
            'the daemon to answer completeAtPoint',
            async () => {
                const list = await completionsAt(position);
                const found = list?.items ?? [];
                return found.some((item) => labelOf(item) === PHP_FN) ? found : undefined;
            },
            10_000
        );

        const php = items.find((item) => labelOf(item) === PHP_FN);
        assert.equal(php?.kind, vscode.CompletionItemKind.Function);
        assert.equal(php?.detail, 'strtoupper(string $string): string');
        // Merged, not replaced: the bundled provider's own items are still there.
        const labels = items.map(labelOf);
        assert.ok(labels.includes(CORE_FN), 'the bundled completions are gone');
        // The Phel symbol the daemon answers alongside the PHP ones is dropped:
        // this provider is the PHP half, and a second copy of `phel.core` is
        // what it must not add.
        assert.ok(
            !labels.includes('str-contains?'),
            'the daemon’s Phel fallback item was offered as an interop one'
        );
    });

    it('offers nothing of its own once the setting is off', async function () {
        await config().update(INTEROP_SETTING, false, vscode.ConfigurationTarget.Global);
        try {
            const position = await typeInteropPosition();
            // Nothing to wait for now, so give the daemon the same chance it
            // had above before concluding it was never asked.
            await waitFor(
                'the bundled completions',
                async () => {
                    const found = (await completionsAt(position))?.items ?? [];
                    return found.some((item) => labelOf(item) === CORE_FN) ? found : undefined;
                },
                10_000
            );
            const labels = ((await completionsAt(position))?.items ?? []).map(labelOf);
            assert.ok(!labels.includes(PHP_FN), `${PHP_FN} was offered with the setting off`);
        } finally {
            await config().update(INTEROP_SETTING, undefined, vscode.ConfigurationTarget.Global);
        }
    });
});
