// Parameter-name inlay hints through the editor's own command. The placement
// rules are unit-tested; what only shows here is that the provider is
// registered against `phel`, that the setting really gates it, and that a
// workspace symbol becomes labelable once the index has seen it.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, openFixture, positionOf, waitFor } from './helpers';

const SETTING = 'inlayHints.parameterNames';

describe('inlay hints', function () {
    let main: vscode.TextDocument;

    before(async function () {
        await activateExtension();
        main = await openFixture('src', 'app', 'main.phel');
    });

    after(async function () {
        await config().update(SETTING, undefined, vscode.ConfigurationTarget.Global);
    });

    it('returns nothing while the setting is off', async function () {
        await config().update(SETTING, false, vscode.ConfigurationTarget.Global);
        assert.deepEqual(await hints(main), []);
    });

    it('labels a core call and a workspace call once enabled', async function () {
        await config().update(SETTING, true, vscode.ConfigurationTarget.Global);

        // `greet` lives in `src/app/core.phel`; it can only be labelled after
        // the workspace index has scanned the fixture.
        const labels = await waitFor('the workspace index to reach inlay hints', async () => {
            const found = (await hints(main)).map(labelOf);
            return found.includes('name:') ? found : undefined;
        });

        // `(map (fn [person] …) people)` against `(map f coll)`.
        assert.ok(labels.includes('f:'), `no \`f:\` among: ${labels.join(', ')}`);
        assert.ok(labels.includes('coll:'), `no \`coll:\` among: ${labels.join(', ')}`);
    });

    it('places the workspace label before the argument, with its signature', async function () {
        await config().update(SETTING, true, vscode.ConfigurationTarget.Global);

        const hint = await waitFor('a hint for the `greet` call', async () => {
            return (await hints(main)).find((h) => labelOf(h) === 'name:');
        });

        const argument = positionOf(main, '(greet person)', '(greet '.length);
        assert.equal(hint.position.isEqual(argument), true, `hint at ${hint.position.character}`);
        assert.equal(hint.kind, vscode.InlayHintKind.Parameter);
        assert.equal(hint.paddingRight, true);
        assert.match(tooltipOf(hint), /\(greet name\)/);
    });
});

function config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('phel');
}

async function hints(doc: vscode.TextDocument): Promise<vscode.InlayHint[]> {
    const full = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
    return (
        (await vscode.commands.executeCommand<vscode.InlayHint[]>(
            'vscode.executeInlayHintProvider',
            doc.uri,
            full
        )) ?? []
    );
}

/** An inlay-hint label is either a string or a list of parts. */
function labelOf(hint: vscode.InlayHint): string {
    return typeof hint.label === 'string' ? hint.label : hint.label.map((p) => p.value).join('');
}

/** Same for the tooltip, which the host may hand back as Markdown. */
function tooltipOf(hint: vscode.InlayHint): string {
    if (!hint.tooltip) {
        return '';
    }
    return typeof hint.tooltip === 'string' ? hint.tooltip : hint.tooltip.value;
}
