// Drives the daemon client against a real child process (`fakeApiDaemon.js`,
// started through `process.execPath`) rather than a stubbed stream: the parts
// that break in practice - a process that never answers, one that dies, one
// that prints a Symfony banner before it says anything - are process
// behaviour, and a fake stream would only assert what we already believe.

import * as assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LspRestartBudget } from '../lspRestartBudget';
import { PhelApiDaemonClient, PhelApiDaemonUnavailableError } from '../phelApiDaemonClient';
import type { DaemonState } from '../phelRuntimeState';

const FAKE_DAEMON = join(__dirname, 'fakeApiDaemon.js');

interface Stats {
    analyzed: number;
    indexed: number;
    /** The params of the last request that was not a `__stats` one. */
    lastParams: Record<string, unknown>;
    pid: number;
}

interface FakeDiagnostic {
    message: string;
    uri?: string;
}

/**
 * A client talking to the fake daemon. `spawnLog` gets one line per process it
 * starts, which is how the restart cases tell "started again" from "never
 * started again".
 */
function createClient(
    options: { spawnLog?: string; budget?: LspRestartBudget; states?: DaemonState[] } = {}
) {
    const args = ['api-daemon'];
    if (options.spawnLog) {
        args.push('--spawn-log', options.spawnLog);
    }
    return new PhelApiDaemonClient({
        command: process.execPath,
        args: [FAKE_DAEMON, ...args],
        budget: options.budget,
        // Short enough to keep the suite quick; the real defaults exist to
        // survive a PHP boot, which node does not need.
        timeouts: { first: 1500, next: 1500 },
        onStateChange: (state) => options.states?.push(state),
    });
}

function analyze(client: PhelApiDaemonClient, source: string, uri: string, key = uri) {
    return client.request<FakeDiagnostic[]>('analyzeSource', { source, uri }, { key });
}

describe('PhelApiDaemonClient', function () {
    // Every case spawns at least one node process.
    this.timeout(20_000);

    let workDir: string;
    let spawnLog: string;
    let client: PhelApiDaemonClient | undefined;

    beforeEach(() => {
        workDir = mkdtempSync(join(tmpdir(), 'phel-daemon-'));
        spawnLog = join(workDir, 'spawns.log');
    });

    afterEach(() => {
        client?.dispose();
        client = undefined;
        assert.ok(workDir.startsWith(tmpdir()), 'refusing to remove a directory outside tmp');
        rmSync(workDir, { recursive: true, force: true });
    });

    /** One line per spawned daemon; absent file means none was ever started. */
    const spawnCount = (): number => {
        try {
            return readFileSync(spawnLog, 'utf8').trim().split('\n').filter(Boolean).length;
        } catch {
            return 0;
        }
    };

    it('answers a request with the daemon result, past the startup banner', async () => {
        client = createClient({ spawnLog });

        const diagnostics = await analyze(client, '(ns a)', '/a.phel');

        assert.equal(diagnostics.length, 1);
        assert.equal(diagnostics[0].message, 'fake:(ns a)');
        assert.equal(diagnostics[0].uri, '/a.phel');
        assert.equal(spawnCount(), 1, 'one process for many requests');
    });

    it('reuses the one process across requests', async () => {
        client = createClient({ spawnLog });

        await analyze(client, '(ns a)', '/a.phel');
        await analyze(client, '(ns a)', '/a.phel');
        const stats = await client.request<Stats>('__stats');

        assert.equal(stats.analyzed, 2);
        assert.equal(spawnCount(), 1);
    });

    it('rejects with the error the daemon reports', async () => {
        client = createClient();

        await assert.rejects(client.request('nope'), /Unknown method: nope/);
    });

    it('replaces a queued request with the newer one under the same key', async () => {
        client = createClient({ spawnLog });

        // The first send goes out immediately, so the next two queue behind it
        // and the third supersedes the second: same key, newer source.
        const first = analyze(client, 'first', '/a.phel');
        const superseded = analyze(client, 'stale', '/b.phel');
        const newest = analyze(client, 'fresh', '/b.phel');

        assert.equal((await first)[0].message, 'fake:first');
        // Documented behaviour: the superseded caller resolves with the newer
        // answer rather than an error, because it is the answer it wanted.
        assert.equal((await superseded)[0].message, 'fake:fresh');
        assert.equal((await newest)[0].message, 'fake:fresh');

        const stats = await client.request<Stats>('__stats');
        assert.equal(stats.analyzed, 2, 'the superseded request is never sent');
    });

    it('keys coalescing per document, so two files do not collide', async () => {
        client = createClient();

        const first = analyze(client, 'first', '/a.phel');
        const other = analyze(client, 'other', '/b.phel');
        const newer = analyze(client, 'newer', '/c.phel');

        assert.equal((await first)[0].message, 'fake:first');
        assert.equal((await other)[0].message, 'fake:other');
        assert.equal((await newer)[0].message, 'fake:newer');
        assert.equal((await client.request<Stats>('__stats')).analyzed, 3);
    });

    it('kills a daemon that stops answering, and starts a new one', async () => {
        client = createClient({ spawnLog });

        const before = await client.request<Stats>('__stats');
        await assert.rejects(
            client.request('analyzeSource', { source: 'x', uri: '/a.phel', __hang: true }),
            /timed out after 1500ms/
        );

        const after = await client.request<Stats>('__stats');
        assert.notEqual(after.pid, before.pid, 'a fresh process serves the next request');
        assert.equal(spawnCount(), 2);
    });

    it('stops restarting once the budget is spent', async () => {
        // One restart allowed: the second death is the end of it.
        client = createClient({ spawnLog, budget: new LspRestartBudget(1, 60_000) });

        await assert.rejects(client.request('analyzeSource', { __crash: true }), /stopped/);
        await assert.rejects(client.request('analyzeSource', { __crash: true }), /unavailable/);

        await assert.rejects(client.request('__stats'), /will not be restarted again/);
        assert.equal(spawnCount(), 2, 'the third request never spawns anything');
    });

    it('goes quiet for the session when the CLI has no such command', async () => {
        client = createClient({ spawnLog });

        await assert.rejects(
            client.request('analyzeSource', { __unknownCommand: true }),
            PhelApiDaemonUnavailableError
        );

        assert.equal(client.unavailable, true);
        await assert.rejects(client.request('__stats'), PhelApiDaemonUnavailableError);
        assert.equal(spawnCount(), 1, 'an unknown command is not retried');
    });

    it('restarts before serving another file once a save marked the deps stale', async () => {
        client = createClient({ spawnLog });

        await analyze(client, '(ns a)', '/a.phel');
        const before = await client.request<Stats>('__stats');

        client.markDepsStale('/a.phel');
        await analyze(client, '(ns a)', '/a.phel');
        const sameFile = await client.request<Stats>('__stats');
        assert.equal(sameFile.pid, before.pid, 'the saved file itself needs no restart');

        await analyze(client, '(ns b)', '/b.phel');
        const otherFile = await client.request<Stats>('__stats');
        assert.notEqual(otherFile.pid, before.pid, 'another file gets a daemon that re-reads it');
        assert.equal(spawnCount(), 2);
    });

    it('fails every request when there is no executable to start', async () => {
        // What a workspace without Phel installed looks like. How it fails is
        // the platform's business - ENOENT from the spawn itself, or, on
        // Windows, `cmd.exe` starting fine and exiting 1 - so this asserts
        // only that every request fails and that the budget still runs out.
        client = new PhelApiDaemonClient({
            command: join(workDir, 'no-such-phel'),
            budget: new LspRestartBudget(1, 60_000),
        });

        await assert.rejects(client.request('__stats'), /Phel analysis daemon/);
        await assert.rejects(client.request('__stats'), /Phel analysis daemon/);
        await assert.rejects(client.request('__stats'), /will not be restarted again/);
    });

    describe('the navigation methods', () => {
        it('reads indexProject back as an index', async () => {
            client = createClient({ spawnLog });

            const index = await client.indexProject(['src', 'tests']);

            assert.ok(index, 'the daemon answered with something that is not an index');
            assert.equal(index.symbols['app.core/greet'].name, 'greet');
            assert.equal(index.references['app.core/greet'].length, 2);
            assert.ok(index.namespaceLocations['app.core'], 'no site for the indexed namespace');
        });

        it('coalesces two indexing requests into one walk of the project', async () => {
            client = createClient();

            // The first send goes out immediately; the second and third share
            // the queue slot, since re-indexing twice in a row answers twice
            // with the same thing.
            const first = client.indexProject(['src']);
            const queued = client.indexProject(['src']);
            const newest = client.indexProject(['src', 'tests']);

            await Promise.all([first, queued, newest]);
            assert.equal((await client.request<Stats>('__stats')).indexed, 2);
        });

        it('reads resolveSymbol back as a definition, and a miss as nothing', async () => {
            client = createClient();

            const found = await client.resolveSymbol('app.core', 'greet');
            const missing = await client.resolveSymbol('app.core', 'nope');

            assert.equal(found?.namespace, 'app.core');
            assert.equal(found?.line, 3);
            assert.equal(found?.col, 7);
            assert.equal(missing, undefined);
        });

        it('sends the namespace in the spelling the index is keyed by', async () => {
            // A namespace written `app\core` reaches the real daemon's index as
            // nothing at all: it keys them dotted. Both methods convert.
            client = createClient();

            await client.resolveSymbol('app\\core', 'greet');
            assert.equal((await client.request<Stats>('__stats')).lastParams.namespace, 'app.core');

            await client.findReferences('app\\core', 'greet');
            assert.equal((await client.request<Stats>('__stats')).lastParams.namespace, 'app.core');
        });

        it('reads findReferences back as locations, and a miss as none', async () => {
            client = createClient();

            const hits = await client.findReferences('app.core', 'greet');

            assert.deepEqual(
                hits.map((hit) => [hit.line, hit.col]),
                [
                    [3, 7],
                    [1, 1],
                ]
            );
            assert.deepEqual(await client.findReferences('app.core', 'nope'), []);
        });
    });

    describe('completeAtPoint', () => {
        it('reads the answer back as completions', async () => {
            client = createClient();

            const items = await client.completeAtPoint('(php/strto', 1, 11, 'k');

            assert.deepEqual(
                items.map((item) => item.label),
                ['strtoupper', 'strtolower', 'str-contains?']
            );
        });

        it('sends the cursor 1-based, as the daemon counts it', async () => {
            client = createClient();

            // `(php/strto` is ten characters, so a cursor after them is col 11.
            await client.completeAtPoint('(ns a)\n(php/strto', 2, 11, 'k');

            const { lastParams } = await client.request<Stats>('__stats');
            assert.equal(lastParams.line, 2);
            assert.equal(lastParams.col, 11);
        });

        it('replaces a queued request under the same key, as keystrokes do', async () => {
            client = createClient();

            const first = client.completeAtPoint('(php/s', 1, 7, '/a.phel:completion');
            const queued = client.completeAtPoint('(php/st', 1, 8, '/a.phel:completion');
            const newest = client.completeAtPoint('(php/str', 1, 9, '/a.phel:completion');

            await Promise.all([first, queued, newest]);
            assert.equal((await client.request<Stats>('__stats')).lastParams.source, '(php/str');
        });
    });

    it('rejects everything once disposed', async () => {
        client = createClient({ spawnLog });
        await analyze(client, '(ns a)', '/a.phel');

        client.dispose();

        await assert.rejects(client.request('__stats'), /disposed/);
        assert.equal(client.running, false);
        assert.equal(spawnCount(), 1);
    });

    // What the status bar reads. Only changes are reported: the client is asked
    // about a document on every keystroke pause, and a status bar rewritten
    // that often would flicker for nothing.
    describe('the state it reports', () => {
        it('is running while a request is out, idle once answered, off when gone', async () => {
            const states: DaemonState[] = [];
            client = createClient({ states });

            await analyze(client, '(ns a)', '/a.phel');
            await analyze(client, '(ns a)', '/a.phel');
            client.dispose();

            assert.deepEqual(states, ['running', 'idle', 'running', 'idle', 'off']);
        });

        it('reports unavailable when the CLI has no such command', async () => {
            const states: DaemonState[] = [];
            client = createClient({ states });

            await assert.rejects(
                client.request('analyzeSource', { __unknownCommand: true }),
                PhelApiDaemonUnavailableError
            );

            assert.deepEqual(states.slice(-1), ['unavailable']);
        });

        it('reports exhausted once the restart budget is spent', async () => {
            const states: DaemonState[] = [];
            client = createClient({ states, budget: new LspRestartBudget(1, 60_000) });

            await assert.rejects(client.request('analyzeSource', { __crash: true }), /stopped/);
            await assert.rejects(client.request('analyzeSource', { __crash: true }), /unavailable/);

            assert.deepEqual(states.slice(-1), ['exhausted']);
        });
    });
});
