// A real debug session, started through the editor's own debug service.
//
// The adapter no longer ships inside `dist/extension.js`; the factory loads
// `dist/phelDebugAdapter.js` the first time a session asks for a descriptor.
// Nothing in the unit suite can see that — it imports the TypeScript modules
// directly — so this is what proves the sibling bundle is packaged, findable,
// and loadable from the extension host.
//
// The session needs no Phel CLI: `launch` only opens an Xdebug listener, and
// the fixture deliberately has no `vendor/bin/phel`.

import * as assert from 'node:assert/strict';
import * as net from 'node:net';
import * as vscode from 'vscode';
import { activateExtension, waitFor } from './helpers';

describe('debug adapter', function () {
    before(async function () {
        await activateExtension();
    });

    afterEach(async function () {
        // Leave no listener behind for the next suite, even after a failure.
        const session = vscode.debug.activeDebugSession;
        if (session) {
            await vscode.debug.stopDebugging(session);
        }
    });

    it('launches a session that listens for Xdebug, then stops cleanly', async function () {
        // A port of our own, so a stray Xdebug listener on the default 9003
        // cannot make this fail.
        const port = await freePort();

        const started = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
            type: 'phel',
            request: 'launch',
            name: 'itest',
            phpDebugPort: port,
        });
        assert.equal(started, true, 'the editor refused to start the Phel debug session');

        const session = await waitFor(
            'the Phel debug session to become active',
            () => vscode.debug.activeDebugSession
        );
        assert.equal(session.type, 'phel');
        assert.equal(session.configuration.phpDebugPort, port);
        await waitFor('the adapter to open its Xdebug port', async () =>
            (await isListening(port)) ? true : undefined
        );

        await vscode.debug.stopDebugging(session);
        await waitFor('the Phel debug session to terminate', () =>
            vscode.debug.activeDebugSession === undefined ? true : undefined
        );
        await waitFor('the Xdebug port to be released', async () =>
            (await isListening(port)) ? undefined : true
        );
    });
});

/** A port nothing is listening on, asked for and released by the OS. */
function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            if (address === null || typeof address === 'string') {
                probe.close(() => reject(new Error('the probe server reported no port')));
                return;
            }
            probe.close(() => resolve(address.port));
        });
    });
}

/** Whether something accepts connections on `port` — i.e. the adapter is up. */
function isListening(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = net.connect({ port, host: '127.0.0.1' });
        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.on('error', () => {
            socket.destroy();
            resolve(false);
        });
    });
}
