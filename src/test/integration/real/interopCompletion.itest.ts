// PHP-interop completion against a real `phel api-daemon`.
//
// Everything asserted here comes out of PHP's own reflection: `strtoupper`'s
// signature, the methods of a `\DateTimeImmutable` the daemon had to type from
// the `(php/new …)` it was bound to, the classes a `\Date…` prefix matches.
// Nothing in this extension knows any of it, which is the point of the feature
// and the reason a fake cannot stand in for the CLI here.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, labelOf, openProject, type, waitFor } from './support';

/** A PHP boot, plus the 400 ms budget each single request gets. */
const DAEMON_TIMEOUT_MS = 90_000;

const INTEROP_SETTING = 'completion.phpInterop';

/** A `phel.core` function; only the bundled provider offers it. */
const CORE_FN = 'map';

describe('PHP-interop completion from a real Phel', function () {
    let scratch: vscode.TextDocument;

    const config = () => vscode.workspace.getConfiguration('phel');

    /**
     * Append `text` and answer with the position right after `cursorAfter`.
     * What is typed stays balanced, so the form a later case types is not read
     * as part of this one.
     */
    async function typeUpTo(text: string, cursorAfter: string): Promise<vscode.Position> {
        await type(scratch, text);
        const at = scratch.getText().lastIndexOf(cursorAfter);
        assert.ok(at >= 0, `the buffer does not hold ${JSON.stringify(cursorAfter)}`);
        return scratch.positionAt(at + cursorAfter.length);
    }

    function completionsAt(position: vscode.Position): Thenable<vscode.CompletionList | undefined> {
        return vscode.commands.executeCommand<vscode.CompletionList>(
            'vscode.executeCompletionItemProvider',
            scratch.uri,
            position
        );
    }

    async function labelsAt(position: vscode.Position): Promise<string[]> {
        return ((await completionsAt(position))?.items ?? []).map(labelOf);
    }

    /**
     * Poll until `label` is among the completions at `position`. The first
     * request pays for a PHP boot and comes back empty, so a single ask proves
     * nothing either way.
     */
    function waitForItem(position: vscode.Position, label: string): Promise<vscode.CompletionItem> {
        return waitFor(
            `the daemon to complete ${label}`,
            async () =>
                ((await completionsAt(position))?.items ?? []).find(
                    (item) => labelOf(item) === label
                ),
            DAEMON_TIMEOUT_MS
        );
    }

    /** Wait for the bundled provider, so an empty popup cannot pass for a quiet one. */
    async function waitForBundled(position: vscode.Position): Promise<void> {
        await waitFor(
            'the bundled completions',
            async () => ((await labelsAt(position)).includes(CORE_FN) ? true : undefined),
            DAEMON_TIMEOUT_MS
        );
    }

    before(async function () {
        await activateExtension();
        scratch = await openProject('src', 'scratch.phel');
    });

    after(async function () {
        await config().update(INTEROP_SETTING, undefined, vscode.ConfigurationTarget.Global);
        // The buffer was never saved; drop the edits so the next suite sees the
        // file the fixture script wrote.
        await vscode.window.showTextDocument(scratch, { preview: false });
        await vscode.commands.executeCommand('workbench.action.files.revert');
    });

    it('completes a PHP global function with the signature PHP reports', async function () {
        const position = await typeUpTo('\n(php/strto)', '(php/strto');

        const item = await waitForItem(position, 'strtoupper');

        assert.equal(item.kind, vscode.CompletionItemKind.Function);
        assert.equal(item.detail, 'strtoupper(string $string): string');
    });

    it('completes the methods of the class a local binding was constructed from', async function () {
        // The receiver follows the member in the dot shorthand, so the daemon
        // reads `d` from the text *after* the cursor and types it from the
        // `(php/new \DateTimeImmutable)` it is bound to.
        const position = await typeUpTo(
            '\n(let [d (php/new \\DateTimeImmutable)] (.for d))',
            '(.for'
        );

        const item = await waitForItem(position, 'format');

        assert.equal(item.kind, vscode.CompletionItemKind.Method);
        assert.equal(item.detail, 'format(string $format)');
    });

    it('completes a class literal from the classes the project can load', async function () {
        const position = await typeUpTo('\n\\DateTi', '\\DateTi');

        const item = await waitForItem(position, 'DateTimeImmutable');

        assert.equal(item.kind, vscode.CompletionItemKind.Class);
        assert.equal(item.detail, 'class');
        // The label is unrooted (`Symfony\Component\…`), so what the item
        // replaces has to stop after the backslash.
        assert.equal(scratch.getText(replacedRange(item)), 'DateTi');
    });

    it('asks the daemon nothing once the setting is off', async function () {
        await config().update(INTEROP_SETTING, false, vscode.ConfigurationTarget.Global);
        const position = await typeUpTo('\n(php/strto)', '(php/strto');

        await waitForBundled(position);

        // The daemon has been warm since the first case, so one ask is enough.
        assert.ok(
            !(await labelsAt(position)).includes('strtoupper'),
            'the daemon was asked with the setting off'
        );
    });
});

/** The range an item replaces, whichever of the two shapes it came back as. */
function replacedRange(item: vscode.CompletionItem): vscode.Range {
    const range = item.range;
    assert.ok(range, 'the item carries no range of its own');
    return range instanceof vscode.Range ? range : range.replacing;
}
