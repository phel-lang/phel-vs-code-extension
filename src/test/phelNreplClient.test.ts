// The nREPL client against a fake server: a real TCP socket speaking the real
// bencode codec, so framing, id correlation, the `.nrepl-port` attach path and
// the per-op timeout are exercised together.
//
// The fake never answers `eval`, which is the only way to reach the timeout
// path deterministically — the same path a hover takes when the runtime is
// busy, and the reason `interrupt` exists.

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { asString, type BencodeValue, decode, encode } from '../bencode';
import { NREPL_PORT_FILE } from '../phelNreplPort';
import { PhelNreplConnection } from '../phelNreplClient';

type Frame = { [key: string]: BencodeValue };

interface FakeServer {
    port: number;
    /** Every op frame the client sent, in order. */
    received: Frame[];
    close: () => Promise<void>;
}

/**
 * A server that clones a session, acknowledges `interrupt`, and stays silent on
 * everything else (`eval` included).
 */
function startFakeNrepl(): Promise<FakeServer> {
    const received: Frame[] = [];
    const sockets: net.Socket[] = [];
    const server = net.createServer((socket) => {
        sockets.push(socket);
        let buffer = Buffer.alloc(0);
        socket.on('error', () => undefined); // the port probe hangs up on us
        socket.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            const { values, consumed } = decode(buffer);
            buffer = buffer.subarray(consumed);
            for (const value of values) {
                const frame = value as Frame;
                received.push(frame);
                const reply = replyTo(frame);
                if (reply) {
                    socket.write(encode(reply));
                }
            }
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as net.AddressInfo;
            resolve({
                port,
                received,
                close: () =>
                    new Promise((done) => {
                        for (const socket of sockets) {
                            socket.destroy();
                        }
                        server.close(() => done());
                    }),
            });
        });
    });
}

function replyTo(frame: Frame): Frame | undefined {
    const id = asString(frame['id']);
    switch (asString(frame['op'])) {
        case 'clone':
            return { id, 'new-session': 'session-1', status: ['done'] };
        case 'interrupt':
            return { id, status: ['done', 'session-idle'] };
        case 'describe':
            return { id, status: ['done'] };
        default:
            return undefined; // notably `eval`: the client has to time out
    }
}

const silentOutput = { append: () => undefined, appendLine: () => undefined };

describe('PhelNreplConnection', function () {
    let server: FakeServer;
    let dir: string;
    let conn: PhelNreplConnection;

    beforeEach(async function () {
        server = await startFakeNrepl();
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phel-nrepl-test-'));
        // The connection attaches to a running server when `.nrepl-port` names
        // one that answers, so nothing is ever spawned here.
        fs.writeFileSync(path.join(dir, NREPL_PORT_FILE), String(server.port));
        const folder = { uri: { fsPath: dir } } as unknown as vscode.WorkspaceFolder;
        conn = await PhelNreplConnection.connect(folder, silentOutput, 'never-spawned');
    });

    afterEach(async function () {
        conn.dispose();
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('attaches to the server named by .nrepl-port and clones a session', function () {
        assert.equal(conn.connected, true);
        assert.equal(conn.attached, true, 'no server was started, so this is an attach');
        assert.equal(asString(server.received[0]['op']), 'clone');
    });

    it('gives up on an op after its own timeout', async function () {
        const started = Date.now();
        await assert.rejects(conn.eval('(inc 1)', undefined, 40), /timed out/);
        // Not the shared 60 s: the per-op value is what applied.
        const elapsed = Date.now() - started;
        assert.ok(elapsed < 1000, `the op waited ${elapsed}ms for a 40ms timeout`);
    });

    it('sends the requested namespace as an in-ns form ahead of the code', async function () {
        await assert.rejects(conn.eval('greet', 'app.core', 40), /timed out/);
        const evalFrame = server.received.find((f) => asString(f['op']) === 'eval');
        // A string, not `'app.core`: the reader turns the quote into a list,
        // and `in-ns` rejects anything that is not a symbol or a string.
        assert.equal(asString(evalFrame?.['code']), '(in-ns "app.core")\ngreet');
        assert.equal(asString(evalFrame?.['session']), 'session-1');
    });

    it('interrupts the session it cloned', async function () {
        const result = await conn.interrupt();
        assert.deepEqual(result.status, ['done', 'session-idle']);
        const interruptFrame = server.received.find((f) => asString(f['op']) === 'interrupt');
        assert.equal(asString(interruptFrame?.['session']), 'session-1');
    });

    it('stays usable after an op timed out', async function () {
        await assert.rejects(conn.eval('(loop [] (recur))', undefined, 40), /timed out/);
        await conn.interrupt();
        assert.equal(conn.connected, true);
    });
});
