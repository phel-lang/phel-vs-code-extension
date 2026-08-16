// nREPL client.
//
// phel-lang ships an nREPL server (`phel nrepl`, bencode-over-TCP). Connecting
// to it gives us structured eval results and errors, completion from the live
// runtime, and the editor-targeted ops `reload` (reload changed namespaces)
// and `run-tests` / `run-test` (run a namespace's tests, or a single test).
//
// A server the user already started is attached to rather than duplicated:
// since Phel 0.50 `phel nrepl` writes its bound port to `.nrepl-port` in the
// working directory (the Clojure-standard discovery file) and removes it on
// exit, so a readable file that answers is a live server for this project.
// Otherwise we start one server per workspace folder on a random free port
// (`--port=0`) and parse the bound port from its banner. Either way we open a
// TCP socket and `clone` a session. Ops are bencoded dicts correlated by an
// `id` we generate; the server streams one or more response frames per op,
// terminated by a `status` containing `done`.
//
// `vscode` is imported for types only and the CLI path is passed in, so the
// whole client can be driven from a plain mocha test against a fake bencode
// server (see `src/test/phelNreplClient.test.ts`).

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { asString, asStringList, type BencodeValue, decode, encode } from './bencode';
import { type PhelInvocation, toInvocation } from './phelInvocation';
import { NREPL_PORT_FILE, parseNreplPortFile } from './phelNreplPort';
import { StringDecoder } from 'node:string_decoder';

const BANNER_RE = /nREPL server started on (\d{1,3}(?:\.\d{1,3}){3}):(\d+)/;
const STARTUP_TIMEOUT_MS = 15000;
const OP_TIMEOUT_MS = 60000;
/** `interrupt` only acknowledges, so it answers at once or not at all. */
const INTERRUPT_TIMEOUT_MS = 2000;
/** How long a `.nrepl-port` server gets to accept before the file is treated as stale. */
const PROBE_TIMEOUT_MS = 2000;

/** The port a `.nrepl-port` file in `cwd` advertises, if there is one. */
async function readNreplPortFile(cwd: string): Promise<number | undefined> {
    try {
        return parseNreplPortFile(await fs.readFile(path.join(cwd, NREPL_PORT_FILE), 'utf8'));
    } catch {
        return undefined; // no file: nothing is advertising
    }
}

/**
 * True when something accepts a TCP connection on `port`. A throwaway socket,
 * so a refused probe never reaches the connection's own close handling.
 */
function portAccepts(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        let settled = false;
        const finish = (ok: boolean): void => {
            if (!settled) {
                settled = true;
                socket.destroy();
                resolve(ok);
            }
        };
        socket.setTimeout(PROBE_TIMEOUT_MS, () => finish(false));
        socket.on('connect', () => finish(true));
        // Stays attached after settling, so a late error on the destroyed
        // socket is swallowed rather than raised as an unhandled event.
        socket.on('error', () => finish(false));
    });
}

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

/** True when the server reported an error status or wrote anything to `err`. */
export function isErrorResult(result: OpResult): boolean {
    return (
        result.status.includes('error') ||
        result.status.includes('eval-error') ||
        result.err.trim() !== ''
    );
}

/** The slice of `vscode.OutputChannel` this client writes to. */
export interface NreplOutput {
    append(text: string): void;
    appendLine(line: string): void;
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
        private readonly output: NreplOutput,
        private readonly command: string,
        private readonly onClose?: () => void
    ) {}

    /**
     * `command` is the resolved Phel CLI, passed in rather than read from the
     * configuration here, so this module needs `vscode` for types only.
     * `onClose` fires when the socket goes away on its own, which `dispose`
     * (the explicit disconnect) does not count as.
     */
    static async connect(
        folder: vscode.WorkspaceFolder,
        output: NreplOutput,
        command: string,
        onClose?: () => void
    ): Promise<PhelNreplConnection> {
        const conn = new PhelNreplConnection(folder, output, command, onClose);
        await conn.startServerAndConnect();
        return conn;
    }

    get connected(): boolean {
        return !this.disposed && this.socket !== undefined && this.sessionId !== '';
    }

    /** True when this connection joined a server the user started, rather than its own. */
    get attached(): boolean {
        return this.socket !== undefined && this.proc === undefined;
    }

    private async startServerAndConnect(): Promise<void> {
        const cwd = this.folder.uri.fsPath;
        const port = (await this.discoverRunningServer(cwd)) ?? (await this.startServer(cwd));
        await this.openSocket(port);
        this.sessionId = await this.cloneSession();
        this.output.appendLine(
            `nREPL session ready on 127.0.0.1:${port} (session ${this.sessionId}).`
        );
    }

    /**
     * The port of a server already running for this folder, per `.nrepl-port`.
     * A file whose port no longer answers is left where it is — the server
     * that wrote it owns it — and reported, since it usually means a crash.
     */
    private async discoverRunningServer(cwd: string): Promise<number | undefined> {
        const port = await readNreplPortFile(cwd);
        if (port === undefined) {
            return undefined;
        }
        if (await portAccepts(port)) {
            this.output.appendLine(
                `Attaching to the running nREPL server on 127.0.0.1:${port} (from ${NREPL_PORT_FILE}).`
            );
            return port;
        }
        this.output.appendLine(
            `${NREPL_PORT_FILE} names port ${port} but nothing answers there; starting a server instead.`
        );
        return undefined;
    }

    private async startServer(cwd: string): Promise<number> {
        const inv = toInvocation(this.command, ['nrepl', '--port=0']);
        this.output.appendLine(
            `Starting nREPL server: ${inv.file} ${inv.args.join(' ')} (cwd ${cwd})`
        );
        return this.spawnAndAwaitPort(inv, cwd);
    }

    private spawnAndAwaitPort(inv: PhelInvocation, cwd: string): Promise<number> {
        return new Promise((resolve, reject) => {
            const proc = spawn(inv.file, inv.args, { cwd, shell: inv.shell });
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

            // Decode across chunk boundaries so a multi-byte character split
            // between two reads does not reach the output channel as U+FFFD.
            const outDecoder = new StringDecoder('utf8');
            const errDecoder = new StringDecoder('utf8');

            const onData = (chunk: Buffer): void => {
                const text = outDecoder.write(chunk);
                if (!text) {
                    return;
                }
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
                const text = errDecoder.write(chunk);
                if (text) {
                    stderr += text;
                    this.output.append(text);
                }
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

    private send(op: { [key: string]: BencodeValue }, timeoutMs?: number): Promise<OpResult> {
        const { promise } = this.sendTracked(op, timeoutMs);
        return promise;
    }

    /**
     * Send an op and return both the result promise and the pending record, so
     * callers that need response fields outside `OpResult` (e.g. `clone`'s
     * `new-session`) can read them once the promise resolves.
     */
    private sendTracked(
        op: { [key: string]: BencodeValue },
        timeoutMs = OP_TIMEOUT_MS
    ): {
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
            }, timeoutMs);
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

    /**
     * `timeoutMs` bounds this op alone; without it the shared 60 s applies.
     * Callers that run on their own (hover evaluation) want to give up long
     * before that.
     */
    eval(code: string, ns?: string, timeoutMs?: number): Promise<OpResult> {
        // The server evaluates in the session's current namespace and has no
        // `ns` op param, so switch the session first with an in-ns form when a
        // namespace is requested. (`*ns*` tracking across evals lives in the
        // session, so this persists for follow-up evals in the same file.)
        //
        // The name goes in as a string, not as `'quoted`: Phel's `in-ns` takes
        // a symbol or a string and the reader turns `'x` into `(quote x)`, so
        // the quoted spelling reaches it as a list and every namespaced eval
        // comes back `AnalyzerException: First argument of 'in-ns must be a
        // Symbol or String`.
        const source = ns ? `(in-ns "${ns}")\n${code}` : code;
        return this.send({ op: 'eval', code: source }, timeoutMs);
    }

    /**
     * Ask the server to abandon what this session is running. Phel's handler
     * (`InterruptOp`) only acknowledges — it evaluates synchronously, so there
     * is nothing to cancel — but sending it keeps the session's frame flow
     * honest and costs one round trip. What actually bounds a runaway op is the
     * caller's `timeoutMs`.
     */
    interrupt(): Promise<OpResult> {
        return this.send({ op: 'interrupt' }, INTERRUPT_TIMEOUT_MS);
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
        this.onClose?.();
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
