// Hovering a `php/<fn>` call against a real Phel.
//
// The manual link is bundled knowledge and needs no CLI; the signature is the
// half only a real one can produce - `phel api-daemon` reflects it out of the
// PHP that is running, so what the hover shows is what this interpreter has,
// not what a corpus of ours once recorded.
//
// The first hover pays for the PHP boot and loses the 400 ms race by design, so
// the assertion polls: the request that lost it fills the cache, and the next
// hover reads it back.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, openProject, positionOf, waitFor } from './support';

/** A PHP boot plus the daemon's first answer. */
const REFLECT_TIMEOUT_MS = 90_000;

async function hoverText(doc: vscode.TextDocument, position: vscode.Position): Promise<string> {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        doc.uri,
        position
    );
    return hovers
        .flatMap((hover) => hover.contents.map((c) => (typeof c === 'string' ? c : c.value)))
        .join('\n');
}

describe('hover over a php/ function', function () {
    let strings: vscode.TextDocument;

    before(async function () {
        await activateExtension();
        strings = await openProject('src', 'strings.phel');
    });

    it('reflects the signature this PHP has, and points at the manual', async function () {
        const position = positionOf(strings, 'php/strtoupper', 5);

        const text = await waitFor(
            'the analysis daemon to reflect strtoupper',
            async () => {
                const shown = await hoverText(strings, position);
                return shown.includes('strtoupper(') ? shown : undefined;
            },
            REFLECT_TIMEOUT_MS
        );

        assert.match(text, /strtoupper\(string \$string\): string/);
        assert.match(text, /https:\/\/www\.php\.net\/manual\/function\.strtoupper\.php/);
    });

    it('leaves an interop special form to its own hover', async function () {
        // `php/new` is a special form, not a function on php.net; the migration
        // note for it is what hovering there has to keep saying.
        const legacy = await openProject('src', 'legacy.phel');
        const text = await hoverText(legacy, positionOf(legacy, 'php/new', 5));

        assert.equal(text.includes('php.net'), false, text);
        assert.match(text, /php\/new/);
    });
});
