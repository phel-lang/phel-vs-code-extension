// Client for `phel api-daemon` (phel-lang >= 0.34): a long-running process
// speaking newline-delimited JSON over stdio. A request is
// `{"id", "method", "params"}`; the answer is `{"id", "result"}` or
// `{"id", "error": {code, message}}`. The methods we care about here are
// `analyzeSource {source, uri}` - the analyzer diagnostics `phel analyze`
// prints - and the three navigation ones (`indexProject`, `resolveSymbol`,
// `findReferences`), but the transport is method-agnostic.
//
// Why a daemon: nearly all of `phel analyze`'s wall time is booting PHP and
// preloading the file's dependencies. That is affordable once per save and
// hopeless per keystroke, so one warm process per workspace folder is what
// makes on-type diagnostics possible at all.
//
// What a warm process cannot do is forget. `PreloadDependenciesStage` really
// evaluates each dependency, and evaluating an already-loaded namespace throws
// `DuplicateDefinitionException` (swallowed), so a saved edit in *another*
// file stays invisible to a process that loaded the old version.
// `markDepsStale` is the bounded answer: the next request for a different file
// restarts the daemon first. That costs one PHP boot per save-then-switch,
// which is exactly what the spawn-per-save path costs today.
//
// Kept free of `vscode` imports so the protocol can be driven from unit tests
// against a fake daemon.

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as readline from 'node:readline';
import { LspRestartBudget } from './lspRestartBudget';
import { isUnknownCommandError } from './phelDiagnostics';
import { toInvocation } from './phelInvocation';
import { normalizeNs } from './phelNsAnalyzer';
import {
    type PhelIndexDefinition,
    type PhelIndexLocation,
    type PhelProjectIndex,
    toDefinition,
    toLocations,
    toProjectIndex,
} from './phelProjectIndex';
import type { DaemonState } from './phelRuntimeState';

/** The daemon takes no arguments of its own. */
const DEFAULT_ARGS = ['api-daemon'];

/**
 * Coalescing key for `indexProject`. Two saves in a row must cost one walk of
 * the project, not two - and the second one is the answer both callers want.
 */
const INDEX_KEY = 'indexProject';

// Same shape as the language client's budget: a daemon that dies immediately
// and repeatedly must not respawn in a tight loop.
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60_000;

/** How long the request that pays for the PHP boot may take. */
const FIRST_REQUEST_TIMEOUT_MS = 20_000;
/** How long every later request on the same process may take. */
const NEXT_REQUEST_TIMEOUT_MS = 10_000;

export interface PhelApiDaemonTimeouts {
    /** Budget for the first request after a (re)start. */
    first: number;
    /** Budget for every request after that. */
    next: number;
}

export interface PhelApiDaemonOptions {
    /** Phel executable, as resolved by `resolvePhelExecutable`. */
    command: string;
    /** Defaults to `["api-daemon"]`. */
    args?: readonly string[];
    /** Working directory; the daemon reads `phel-config.php` from it. */
    cwd?: string;
    /** Defaults to 5 restarts per 60 s. */
    budget?: LspRestartBudget;
    timeouts?: PhelApiDaemonTimeouts;
    log?: (message: string) => void;
    /**
     * Called whenever the process behind this client changes what it can do:
     * `running` while a request is out, `idle` once it is answered, `off` when
     * the process is gone, and the two terminal ones. Only on a change, so a
     * keystroke storm is not an event storm.
     */
    onStateChange?: (state: DaemonState) => void;
}

export interface PhelApiDaemonRequestOptions {
    /**
     * Coalescing key - the document uri, for the analysis requests. A request
     * that is still queued under the same key is replaced by the newer one,
     * and both callers resolve with the newer result: an editor that asked
     * about a buffer twice wants the answer for what the buffer says now.
     */
    key?: string;
}

/** The installed Phel has no `api-daemon` command; nothing will change that. */
export class PhelApiDaemonUnavailableError extends Error {}

interface Waiter {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
}

interface QueuedRequest {
    key?: string;
    method: string;
    params: Record<string, unknown>;
    /** Every caller coalesced into this request; all settle together. */
    waiters: Waiter[];
}

interface InFlightRequest extends QueuedRequest {
    id: number;
    timer: NodeJS.Timeout;
    timeoutMs: number;
}

interface DaemonProcess {
    child: ChildProcessWithoutNullStreams;
    reader: readline.Interface;
}

/**
 * One daemon process, started on the first request and restarted (within the
 * budget) whenever it dies or stops answering. Requests are sent one at a
 * time: the daemon handles them sequentially anyway, and a single in-flight
 * request is what makes both the per-request timeout and the coalescing of
 * everything still queued meaningful.
 */
export class PhelApiDaemonClient {
    private readonly command: string;
    private readonly args: string[];
    private readonly cwd?: string;
    private readonly budget: LspRestartBudget;
    private readonly timeouts: PhelApiDaemonTimeouts;
    private readonly log: (message: string) => void;
    private readonly onStateChange: (state: DaemonState) => void;

    private proc?: DaemonProcess;
    private queue: QueuedRequest[] = [];
    private inFlight?: InFlightRequest;
    private nextId = 1;
    /** False until this process has answered once, so it gets the long budget. */
    private booted = false;
    private stderr = '';
    /** Uri of the last save; a request for any other file restarts first. */
    private staleAfter?: string;
    private restartBeforeNextSend = false;
    private unavailableFlag = false;
    private exhausted = false;
    private disposed = false;
    /** Last state reported to `onStateChange`. */
    private state: DaemonState = 'off';

    constructor(options: PhelApiDaemonOptions) {
        this.command = options.command;
        this.args = [...(options.args ?? DEFAULT_ARGS)];
        this.cwd = options.cwd;
        this.budget = options.budget ?? new LspRestartBudget(MAX_RESTARTS, RESTART_WINDOW_MS);
        this.timeouts = options.timeouts ?? {
            first: FIRST_REQUEST_TIMEOUT_MS,
            next: NEXT_REQUEST_TIMEOUT_MS,
        };
        this.log = options.log ?? (() => undefined);
        this.onStateChange = options.onStateChange ?? (() => undefined);
    }

    /** True once the CLI rejected the subcommand. Stays true for the session. */
    get unavailable(): boolean {
        return this.unavailableFlag;
    }

    /** True while a daemon process is up (for logging and tests). */
    get running(): boolean {
        return this.proc !== undefined;
    }

    /**
     * Send `method` with `params`. Resolves with the response's `result`, or
     * rejects with the daemon's error message, a timeout, or the death of the
     * process.
     */
    request<T>(
        method: string,
        params: Record<string, unknown> = {},
        options: PhelApiDaemonRequestOptions = {}
    ): Promise<T> {
        if (this.disposed) {
            return Promise.reject(new Error('The Phel analysis daemon client is disposed.'));
        }
        if (this.unavailableFlag) {
            return Promise.reject(
                new PhelApiDaemonUnavailableError('This Phel CLI has no `api-daemon` command.')
            );
        }
        if (this.exhausted) {
            return Promise.reject(
                new Error('The Phel analysis daemon kept failing and will not be restarted again.')
            );
        }

        // A save invalidates what the daemon loaded for every *other* file.
        const uri = typeof params.uri === 'string' ? params.uri : undefined;
        if (this.staleAfter !== undefined && uri !== undefined && uri !== this.staleAfter) {
            this.staleAfter = undefined;
            this.restartBeforeNextSend = true;
        }

        return new Promise<T>((resolve, reject) => {
            const waiter: Waiter = { resolve: (value) => resolve(value as T), reject };
            const queued =
                options.key === undefined
                    ? undefined
                    : this.queue.find((entry) => entry.key === options.key);
            if (queued) {
                queued.method = method;
                queued.params = params;
                queued.waiters.push(waiter);
            } else {
                this.queue.push({ key: options.key, method, params, waiters: [waiter] });
            }
            this.pump();
        });
    }

    /**
     * Walk `srcDirs` and cache the resulting index *in the daemon process*, so
     * `resolveSymbol` and `findReferences` have something to answer from. The
     * paths are resolved against the daemon's working directory, so the
     * relative `src-dirs` a project config prints can be passed through.
     *
     * Resolves `undefined` when the answer is not an index - an older daemon
     * without the method rejects instead, like every other request.
     */
    async indexProject(srcDirs: readonly string[]): Promise<PhelProjectIndex | undefined> {
        return toProjectIndex(
            await this.request<unknown>(
                'indexProject',
                { srcDirs: [...srcDirs] },
                { key: INDEX_KEY }
            )
        );
    }

    /**
     * The definition `symbol` names as seen from `namespace`, or `undefined`
     * when the cached index has none. An unqualified symbol is looked up under
     * `namespace/symbol` first and by bare name across the project after that,
     * so the answer is namespace-aware where it can be.
     */
    async resolveSymbol(
        namespace: string,
        symbol: string
    ): Promise<PhelIndexDefinition | undefined> {
        return toDefinition(
            await this.request<unknown>('resolveSymbol', {
                namespace: normalizeNs(namespace),
                symbol,
            })
        );
    }

    /** Every reference site the cached index holds for `namespace/symbol`. */
    async findReferences(namespace: string, symbol: string): Promise<PhelIndexLocation[]> {
        return toLocations(
            await this.request<unknown>('findReferences', {
                namespace: normalizeNs(namespace),
                symbol,
            })
        );
    }

    /**
     * Record that `savedUri` was written to disk. The daemon keeps whatever it
     * evaluated for the previous version, so the next request about another
     * file gets a fresh process; a follow-up request about `savedUri` itself
     * does not, since the file under analysis is read from the buffer anyway.
     */
    markDepsStale(savedUri: string): void {
        this.staleAfter = savedUri;
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.failAll(new Error('The Phel analysis daemon client is disposed.'));
        this.stopProcess();
    }

    /** Send the next queued request, if the previous one has been answered. */
    private pump(): void {
        if (this.disposed || this.inFlight || this.queue.length === 0) {
            return;
        }
        if (this.restartBeforeNextSend) {
            this.restartBeforeNextSend = false;
            if (this.proc) {
                this.log('Restarting the analysis daemon: a save changed what it had loaded.');
                this.stopProcess();
            }
        }

        const proc = this.ensureProcess();
        if (!proc) {
            return; // the spawn failed; the queue fails with it
        }
        const next = this.queue.shift() as QueuedRequest;
        const id = this.nextId++;
        const timeoutMs = this.booted ? this.timeouts.next : this.timeouts.first;
        const timer = setTimeout(() => this.onTimeout(), timeoutMs);
        timer.unref(); // a pending timeout must not keep the host process alive
        this.inFlight = { ...next, id, timer, timeoutMs };
        proc.child.stdin.write(
            `${JSON.stringify({ id, method: next.method, params: next.params })}\n`
        );
        this.setState('running');
    }

    private ensureProcess(): DaemonProcess | undefined {
        if (this.proc) {
            return this.proc;
        }
        // Windows cannot start the extension-less Composer proxy directly;
        // `toInvocation` turns it into `php vendor/bin/phel api-daemon`.
        const inv = toInvocation(this.command, this.args);
        let child: ChildProcessWithoutNullStreams;
        try {
            child = spawn(inv.file, inv.args, { cwd: this.cwd, shell: inv.shell });
        } catch (err) {
            this.failAll(toError(err));
            return undefined;
        }

        const proc: DaemonProcess = {
            child,
            reader: readline.createInterface({ input: child.stdout }),
        };
        this.proc = proc;
        this.booted = false;
        this.stderr = '';

        // Every handler ignores a process this client has already moved on
        // from, so a restart cannot be disturbed by the old one's death rattle.
        proc.reader.on('line', (line: string) => {
            if (this.proc === proc) {
                this.onLine(line);
            }
        });
        child.stderr.on('data', (chunk: Buffer) => {
            if (this.proc === proc) {
                this.onStderr(chunk.toString());
            }
        });
        // Writing to a daemon that is on its way out must not raise EPIPE.
        child.stdin.on('error', () => undefined);
        child.on('error', (err: Error) => {
            if (this.proc === proc) {
                this.onProcessGone(err.message);
            }
        });
        // `close` rather than `exit`: it fires once stdio has drained, so a
        // parting message on stderr is always read before we decide what the
        // death meant.
        child.on('close', (code: number | null) => {
            if (this.proc === proc) {
                this.onProcessGone(`exit code ${code ?? 'unknown'}`);
            }
        });

        this.log(`Starting the analysis daemon: ${inv.file} ${inv.args.join(' ')}`);
        if (child.pid === undefined) {
            // `spawn` knows a missing executable straight away and reports it
            // through an `error` event on the next tick - which the handler
            // above turns into a failed queue. Handing this process a request
            // would only write into a pipe whose other end never existed.
            return undefined;
        }
        return proc;
    }

    private onLine(line: string): void {
        const trimmed = line.trim();
        // Symfony writes banners and `<error>` blocks to stdout; only a JSON
        // object can be a response, and anything else is noise by definition.
        if (!trimmed.startsWith('{')) {
            return;
        }
        let decoded: unknown;
        try {
            decoded = JSON.parse(trimmed);
        } catch {
            return;
        }
        if (!decoded || typeof decoded !== 'object') {
            return;
        }
        const response = decoded as {
            id?: unknown;
            result?: unknown;
            error?: { message?: unknown };
        };
        const flight = this.inFlight;
        if (!flight || response.id !== flight.id) {
            return; // an answer to something we no longer wait for
        }

        this.inFlight = undefined;
        this.booted = true;
        clearTimeout(flight.timer);
        if (response.error) {
            const detail =
                typeof response.error.message === 'string'
                    ? response.error.message
                    : 'unknown daemon error';
            rejectAll(flight.waiters, new Error(detail));
        } else {
            for (const waiter of flight.waiters) {
                waiter.resolve(response.result);
            }
        }
        this.pump();
        if (!this.inFlight) {
            // Nothing was queued behind it: a warm process with nothing to do.
            this.setState('idle');
        }
    }

    private onStderr(text: string): void {
        // Keep only the tail: a chunk boundary must not split the one line we
        // look for, and an unbounded buffer would grow with every PHP notice.
        this.stderr = (this.stderr + text).slice(-4096);
        if (!isUnknownCommandError(this.stderr)) {
            this.log(text.trimEnd());
            return;
        }
        this.unavailableFlag = true;
        this.log('This Phel CLI has no `api-daemon` command; live analysis stays off.');
        // Not a crash to recover from, so the restart budget is untouched.
        this.stopProcess();
        this.setState('unavailable');
        this.failAll(
            new PhelApiDaemonUnavailableError('This Phel CLI has no `api-daemon` command.')
        );
    }

    private onTimeout(): void {
        const flight = this.inFlight;
        if (!flight) {
            return;
        }
        this.inFlight = undefined;
        clearTimeout(flight.timer);
        this.log(
            `The analysis daemon did not answer "${flight.method}" within ${flight.timeoutMs}ms; killing it.`
        );
        rejectAll(
            flight.waiters,
            new Error(`The Phel analysis daemon timed out after ${flight.timeoutMs}ms.`)
        );
        // Drop the process here rather than waiting for the kill to land, so
        // the next request cannot be written into a pipe that is closing.
        this.stopProcess();
        // A hung PHP costs one restart from the budget, not the session.
        this.handleProcessLoss(`no answer within ${flight.timeoutMs}ms`);
    }

    private onProcessGone(detail: string): void {
        this.proc?.reader.close();
        this.proc = undefined;
        this.setState('off');
        if (this.disposed) {
            return;
        }
        this.handleProcessLoss(detail);
    }

    /** Spend a restart on a daemon that is gone, or give up on it entirely. */
    private handleProcessLoss(detail: string): void {
        if (!this.budget.shouldRestart()) {
            this.exhausted = true;
            this.setState('exhausted');
            this.log(
                `The analysis daemon failed ${this.budget.count} times within ` +
                    `${Math.round(RESTART_WINDOW_MS / 1000)}s (${detail}); not starting it again. ` +
                    'Live analysis is off until the setting or the executable changes.'
            );
            this.failAll(new Error(`The Phel analysis daemon is unavailable (${detail}).`));
            return;
        }
        this.log(
            `The analysis daemon stopped (${detail}); the next request starts a new one ` +
                `(${this.budget.count}/${MAX_RESTARTS}).`
        );
        this.failAll(new Error(`The Phel analysis daemon stopped (${detail}).`));
    }

    private stopProcess(): void {
        const proc = this.proc;
        if (!proc) {
            return;
        }
        // Clearing the reference first is what tells the handlers to ignore
        // the `close` this kill is about to produce.
        this.proc = undefined;
        proc.reader.close();
        proc.child.stdin.end();
        if (!proc.child.killed) {
            proc.child.kill();
        }
        this.setState('off');
    }

    /** Report a change in what this client can do; identical sets are dropped. */
    private setState(state: DaemonState): void {
        if (this.state === state) {
            return;
        }
        this.state = state;
        this.onStateChange(state);
    }

    private failAll(err: Error): void {
        const flight = this.inFlight;
        this.inFlight = undefined;
        if (flight) {
            clearTimeout(flight.timer);
            rejectAll(flight.waiters, err);
        }
        const queued = this.queue;
        this.queue = [];
        for (const entry of queued) {
            rejectAll(entry.waiters, err);
        }
    }
}

function rejectAll(waiters: readonly Waiter[], err: Error): void {
    for (const waiter of waiters) {
        waiter.reject(err);
    }
}

function toError(err: unknown): Error {
    return err instanceof Error ? err : new Error(String(err));
}
