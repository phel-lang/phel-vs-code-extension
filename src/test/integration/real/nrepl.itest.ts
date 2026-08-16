// The nREPL commands against a real `phel nrepl` server.
//
// What is observable from the extension host is the hover: with a live
// connection, hovering a symbol shows what the runtime says it is right now, so
// `=> 42` in a hover is proof that a server started, a session was cloned, the
// file was loaded and an `eval` op came back. The notification `phel.nrepl.connect`
// shows, and the `attached` flag behind it, are not: `showInformationMessage`
// has no reader, and the connection registry is module state inside the bundle
// the host loaded, which an `out/` import here would not share.
//
// The attach case is therefore asserted through `.nrepl-port`, which is the
// mechanism itself: a server the extension starts writes its own port there,
// so a file that still names the server *we* started is a connection that did
// not start a second one.

import * as assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { activateExtension, openProject, positionOf, projectPath, waitFor } from './support';

/** Phel writes the port here once the socket is listening, and removes it on exit. */
const PORT_FILE = '.nrepl-port';

async function portFile(): Promise<string | undefined> {
    try {
        return await fs.readFile(projectPath(PORT_FILE), 'utf-8');
    } catch {
        return undefined;
    }
}

describe('nREPL against a real Phel server', function () {
    let target: vscode.TextDocument;
    let external: ChildProcess | undefined;

    /** The `=> …` hover the nREPL hover provider contributes, if any. */
    async function evalHover(): Promise<string | undefined> {
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
            'vscode.executeHoverProvider',
            target.uri,
            positionOf(target, '(def answer 42)', 5)
        );
        for (const hover of hovers ?? []) {
            for (const part of hover.contents) {
                const text = typeof part === 'string' ? part : part.value;
                if (text.includes('=>')) {
                    return text;
                }
            }
        }
        return undefined;
    }

    before(async function () {
        await activateExtension();
        target = await openProject('src', 'repl_target.phel');
    });

    afterEach(async function () {
        await vscode.commands.executeCommand('phel.nrepl.disconnect');
    });

    after(function () {
        external?.kill();
    });

    it('starts a server, loads the file and evaluates on hover', async function () {
        await vscode.commands.executeCommand('phel.nrepl.connect');
        // The runtime has to know the namespace before a hover can deref
        // anything in it.
        await vscode.commands.executeCommand('phel.nrepl.loadFile');

        const hover = await waitFor('the nREPL hover', () => evalHover(), 60_000);
        assert.match(hover, /=> 42/);
    });

    it('attaches to a server that is already running, per .nrepl-port', async function () {
        await waitFor(
            'the previous server to remove its .nrepl-port',
            async () => ((await portFile()) === undefined ? true : undefined),
            30_000
        );

        external = spawn(projectPath('bin', 'phel'), ['nrepl', '--port=0'], {
            cwd: projectPath(),
        });
        const written = await waitFor(
            'our own server to write .nrepl-port',
            () => portFile(),
            60_000
        );

        await vscode.commands.executeCommand('phel.nrepl.connect');
        await vscode.commands.executeCommand('phel.nrepl.loadFile');
        const hover = await waitFor('the nREPL hover', () => evalHover(), 60_000);

        assert.match(hover, /=> 42/);
        assert.equal(
            await portFile(),
            written,
            'the extension started a server of its own instead of attaching'
        );
    });
});
