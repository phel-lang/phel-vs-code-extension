// The shipped bundles, checked in the host that has to load them.
//
// `dist/extension.js` is what activation costs, and it is kept small by
// deferring two subsystems to sibling bundles: `phelLanguageClient.js` (only
// when `phel.lsp.enabled` is on, which it is not by default) and
// `phelDebugAdapter.js` (only once a debug session starts). Two things can
// break that quietly and neither is visible to the unit suite, which imports
// the TypeScript sources rather than the bundle:
//
//   * a static import creeping back into `src/extension.ts`, pulling
//     `vscode-languageclient` back into the activation path;
//   * a sibling bundle that is not packaged, or cannot be loaded from the
//     extension host at all (`require('vscode')` inside it has to keep
//     resolving through the host's module interceptor).
//
// So: assert the split from the metafile esbuild writes, then actually load
// both siblings the way the extension does.

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { activateExtension } from './helpers';

const DIST = path.resolve(__dirname, '../../../dist');

interface Metafile {
    outputs: Record<string, { bytes: number; inputs: Record<string, unknown> }>;
}

describe('shipped bundles', function () {
    let metafile: Metafile;

    before(async function () {
        await activateExtension();
        const meta = path.join(DIST, 'meta.json');
        assert.equal(fs.existsSync(meta), true, `${meta} is missing; run \`npm run bundle\``);
        metafile = JSON.parse(fs.readFileSync(meta, 'utf-8')) as Metafile;
    });

    it('emits the activation bundle and both deferred siblings', function () {
        const emitted = Object.keys(metafile.outputs).filter((f) => f.endsWith('.js'));
        assert.deepEqual(emitted.sort(), [
            'dist/extension.js',
            'dist/phelDebugAdapter.js',
            'dist/phelLanguageClient.js',
        ]);
    });

    it('keeps the language client and the debug adapter out of the activation bundle', function () {
        const inputs = Object.keys(metafile.outputs['dist/extension.js'].inputs);
        const leaked = inputs.filter((input) =>
            /vscode-languageclient|vscode-jsonrpc|vscode-languageserver|@vscode\/debugadapter|phelDebugAdapter\.ts/.test(
                input
            )
        );
        assert.deepEqual(
            leaked,
            [],
            'these belong in a deferred bundle, not on the activation path'
        );
    });

    it('loads both deferred bundles from the extension host', async function () {
        const client = await importDist('phelLanguageClient.js');
        assert.equal(typeof client.startLanguageClient, 'function');

        const adapter = await importDist('phelDebugAdapter.js');
        assert.equal(typeof adapter.PhelDebugSession, 'function');
    });
});

/**
 * Load a sibling bundle exactly as `src/extension.ts` does — a dynamic import
 * of the emitted CommonJS file, which is the part with something to prove.
 */
async function importDist(file: string): Promise<Record<string, unknown>> {
    const full = path.join(DIST, file);
    assert.equal(fs.existsSync(full), true, `${full} was not packaged`);
    return (await import(pathToFileURL(full).href)) as Record<string, unknown>;
}
