// nREPL client.
//
// phel-lang ships an nREPL server (`phel nrepl`, bencode-over-TCP). Connecting
// to it gives us structured eval results and errors, completion from the live
// runtime, and the editor-targeted ops `reload` (reload changed namespaces)
// and `run-tests` / `run-test` (run a namespace's tests, or a single test).
//
// We start one server per workspace folder on a random free port (`--port=0`),
// parse the bound port from its banner, open a TCP socket, and `clone` a
// session. Ops are bencoded dicts correlated by an `id` we generate; the server
// streams one or more response frames per op, terminated by a `status`
// containing `done`.

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as net from 'node:net';
import * as vscode from 'vscode';
import { asString, asStringList, type BencodeValue, decode, encode } from './bencode';
import { resolvePhelExecutable } from './phelExecutable';

const BANNER_RE = /nREPL server started on (\d{1,3}(?:\.\d{1,3}){3}):(\d+)/;
const STARTUP_TIMEOUT_MS = 15000;
const OP_TIMEOUT_MS = 60000;

export interface OpResult {
    /** Concatenated `value` frames (eval results). */
    values: string[];
    /** Concatenated `out` frames (stdout from the evaluated code). */
    out: string;
    /** Concatenated `err` frames plus any `ex` / error-status detail. */
    err: string;
    /** Union of every `status` token seen across the response frames. */
    status: string[];
}

interface PendingOp {
    resolve: (result: OpResult) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
    acc: OpResult;
    /** Captured `new-session` value (only set for the `clone` op). */
    newSession?: string;
}

/**
 * A live connection to a `phel nrepl` server for one workspace folder.
 */
export class PhelNreplConnection {
    private proc?: ChildProcessWithoutNullStreams;
    private socket?: net.Socket;
    private sessionId = '';
    private buffer = Buffer.alloc(0);
    private nextId = 1;
    private readonly pending = new Map<string, PendingOp>();
    private disposed = false;

    private constructor(
        readonly folder: vscode.WorkspaceFolder,
        private readonly output: vscode.OutputChannel
    ) {}

    static async connect(
        folder: vscode.WorkspaceFolder,
        output: vscode.OutputChannel
    ): Promise<PhelNreplConnection> {
        const conn = new PhelNreplConnection(folder, output);
        await conn.startServerAndConnect();
        return conn;
    }

    get connected(): boolean {
        return !this.disposed && this.socket !== undefined && this.sessionId !== '';
    }

    private async startServerAndConnect(): Promise<void> {
        const command = resolvePhelExecutable('repl.command', this.folder);
        const cwd = this.folder.uri.fsPath;
        this.output.appendLine(`Starting nREPL server: ${command} nrepl --port=0 (cwd ${cwd})`);

        const port = await this.spawnAndAwaitPort(command, cwd);
        await this.openSocket(port);
        this.sessionId = await this.cloneSession();
        this.output.appendLine(
            `nREPL session ready on 127.0.0.1:${port} (session ${this.sessionId}).`
        );
    }

    private spawnAndAwaitPort(command: string, cwd: string): Promise<number> {
        return new Promise((resolve, reject) => {
            const proc = spawn(command, ['nrepl', '--port=0'], { cwd });
            this.proc = proc;
            let settled = false;
            let stderr = '';

            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    proc.kill();
                    reject(new Error('Timed out waiting for the nREPL server to start.'));
                }
            }, STARTUP_TIMEOUT_MS);
            timer.unref(); // a pending timeout must not keep the host process alive

            const onData = (chunk: Buffer): void => {
                const text = chunk.toString();
                this.output.append(text);
                const match = BANNER_RE.exec(text);
                if (match && !settled) {
                    settled = true;
                    clearTimeout(timer);
                    resolve(Number.parseInt(match[2], 10));
                }
            };

            proc.stdout.on('data', onData);
            proc.stderr.on('data', (chunk: Buffer) => {
                stderr += chunk.toString();
                this.output.append(chunk.toString());
            });
            proc.on('error', (err) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    reject(err);
                }
            });
            proc.on('exit', (code) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    reject(
                        new Error(
                            `nREPL server exited (code ${code ?? 'unknown'}) before binding a port.` +
                                (stderr ? `\n${stderr.trim()}` : '')
                        )
                    );
                }
                this.handleClose();
            });
        });
    }

    private openSocket(port: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection({ host: '127.0.0.1', port }, () => resolve());
            this.socket = socket;
            socket.on('data', (chunk) => this.onSocketData(chunk));
            socket.on('error', (err) => {
                reject(err);
                this.failAllPending(err);
            });
            socket.on('close', () => this.handleClose());
        });
    }

    private onSocketData(chunk: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        let values;
        let consumed;
        try {
            ({ values, consumed } = decode(this.buffer));
        } catch (err) {
            // A malformed frame would otherwise throw out of this 'data' handler
            // as an unhandled error and hang every pending op. Recover instead:
            // log, drop the corrupt buffer, and reject in-flight ops.
            const message = err instanceof Error ? err.message : String(err);
            this.output.appendLine(`nREPL: discarding malformed frame (${message}).`);
            this.buffer = Buffer.alloc(0);
            this.failAllPending(new Error(`nREPL protocol error: ${message}`));
            return;
        }
        if (consumed > 0) {
            this.buffer = this.buffer.subarray(consumed);
        }
        for (const value of values) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                this.handleFrame(value);
            }
        }
    }

    private handleFrame(frame: { [key: string]: BencodeValue }): void {
        const id = asString(frame['id']);
        const op = this.pending.get(id);
        if (!op) {
            return;
        }
        if (frame['value'] !== undefined) {
            op.acc.values.push(asString(frame['value']));
        }
        if (frame['out'] !== undefined) {
            op.acc.out += asString(frame['out']);
        }
        if (frame['err'] !== undefined) {
            op.acc.err += asString(frame['err']);
        }
        if (frame['ex'] !== undefined) {
            op.acc.err += asString(frame['ex']);
        }
        if (frame['new-session'] !== undefined) {
            op.newSession = asString(frame['new-session']);
        }
        const status = asStringList(frame['status']);
        for (const token of status) {
            if (!op.acc.status.includes(token)) {
                op.acc.status.push(token);
            }
        }
        if (status.includes('done')) {
            clearTimeout(op.timer);
            this.pending.delete(id);
            op.resolve(op.acc);
        }
    }

    private send(op: { [key: string]: BencodeValue }): Promise<OpResult> {
        const { promise } = this.sendTracked(op);
        return promise;
    }

    /**
     * Send an op and return both the result promise and the pending record, so
     * callers that need response fields outside `OpResult` (e.g. `clone`'s
     * `new-session`) can read them once the promise resolves.
     */
    private sendTracked(op: { [key: string]: BencodeValue }): {
        promise: Promise<OpResult>;
        getNewSession: () => string | undefined;
    } {
        let pendingRef: PendingOp | undefined;
        const promise = new Promise<OpResult>((resolve, reject) => {
            if (!this.socket || this.disposed) {
                reject(new Error('nREPL connection is not open.'));
                return;
            }
            const id = String(this.nextId++);
            const frame: { [key: string]: BencodeValue } = { ...op, id };
            if (this.sessionId && frame['session'] === undefined) {
                frame['session'] = this.sessionId;
            }
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`nREPL op "${asString(op['op'])}" timed out.`));
            }, OP_TIMEOUT_MS);
            timer.unref(); // a pending timeout must not keep the host process alive
            const pending: PendingOp = {
                resolve,
                reject,
                timer,
                acc: { values: [], out: '', err: '', status: [] },
            };
            pendingRef = pending;
            this.pending.set(id, pending);
            this.socket.write(encode(frame));
        });
        return { promise, getNewSession: () => pendingRef?.newSession };
    }

    private async cloneSession(): Promise<string> {
        const { promise, getNewSession } = this.sendTracked({ op: 'clone' });
        await promise;
        return getNewSession() ?? '';
    }

    eval(code: string, ns?: string): Promise<OpResult> {
        // The server evaluates in the session's current namespace and has no
        // `ns` op param, so switch the session first with an in-ns form when a
        // namespace is requested. (`*ns*` tracking across evals lives in the
        // session, so this persists for follow-up evals in the same file.)
        const source = ns ? `(in-ns '${ns})\n${code}` : code;
        return this.send({ op: 'eval', code: source });
    }

    loadFile(content: string, filePath: string): Promise<OpResult> {
        // The server reads the source name from `file-name` (used in compile
        // error locations); `file` carries the contents.
        return this.send({ op: 'load-file', file: content, 'file-name': filePath });
    }

    reload(all = false): Promise<OpResult> {
        return this.send({ op: 'reload', all: all ? '1' : '0' });
    }

    runTests(ns: string, testVar?: string): Promise<OpResult> {
        const op: { [key: string]: BencodeValue } = { op: 'run-tests', ns };
        if (testVar) {
            op['var'] = testVar;
        }
        return this.send(op);
    }

    private failAllPending(err: Error): void {
        for (const [id, op] of this.pending) {
            clearTimeout(op.timer);
            op.reject(err);
            this.pending.delete(id);
        }
    }

    private handleClose(): void {
        if (this.disposed) {
            return;
        }
        this.failAllPending(new Error('nREPL connection closed.'));
        this.sessionId = '';
        // Reap the server process if it outlived the socket so it isn't orphaned
        // until the next explicit disconnect.
        if (this.proc && !this.proc.killed) {
            this.proc.kill();
        }
        this.proc = undefined;
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.failAllPending(new Error('nREPL connection disposed.'));
        this.socket?.destroy();
        this.socket = undefined;
        if (this.proc && !this.proc.killed) {
            this.proc.kill();
        }
        this.proc = undefined;
        this.sessionId = '';
    }
}
