import {
    LoggingDebugSession,
    InitializedEvent,
    StoppedEvent,
    TerminatedEvent,
    BreakpointEvent,
    OutputEvent,
    Thread,
    StackFrame,
    Scope,
    Source,
    Breakpoint,
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { SourceMapManager } from './sourceMapManager';
import { XdebugBreakpointRegistry } from './xdebugBreakpointRegistry';
import { XdebugPendingCommands } from './xdebugPendingCommands';
import { DbgpMessageReader } from './dbgpMessageReader';
import { formatDbgpCommand } from './dbgpCommand';
import { decodeDbgpCdata } from './dbgpValueDecoder';
import {
    type BreakpointSetResult,
    parseBreakLocation,
    parseBreakpointSetResponse,
} from './xdebugResponse';
import {
    type BreakpointOptions,
    breakpointSetArgs,
    interpolateLogMessage,
    matchBreakpoint,
    phelExpressionToPhp,
} from './xdebugBreakpointConditions';

interface PhelLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    program?: string;
    stopOnEntry?: boolean;
    phpDebugPort?: number;
    pathMappings?: { [key: string]: string };
    cacheDir?: string;
    skipPhelInternals?: boolean;
    skipFiles?: string[];
}

interface PhelBreakpoint {
    id: number;
    verified: boolean;
    phelFile: string;
    phelLine: number;
    phpFile: string | null;
    phpLine: number | null;
    /**
     * Every PHP line installed for this breakpoint. One Phel line can compile
     * to several expressions, and the engine reports the line it stopped on —
     * so recognising a hit means knowing all of them, not just the primary.
     */
    phpLines: number[];
    /** Stop only when Xdebug finds this expression truthy. */
    condition?: string;
    /** VS Code's hit-count expression, e.g. `>= 3`. */
    hitCondition?: string;
    /** A logpoint: print this and keep running, never stop. */
    logMessage?: string;
}

/**
 * Connection state for handling Xdebug lifecycle.
 */
type ConnectionState = 'listening' | 'connected' | 'running';

/**
 * Phel Debug Adapter
 *
 * This adapter acts as a proxy between VS Code and Xdebug (DBGp protocol).
 * It translates breakpoints from .phel files to .php files using source maps,
 * and translates stack frames back from .php to .phel.
 *
 * Cross-platform compatible: Windows, macOS, Linux.
 */
export class PhelDebugSession extends LoggingDebugSession {
    private static THREAD_ID = 1;

    private sourceMapManager: SourceMapManager;
    private breakpoints: Map<string, PhelBreakpoint[]> = new Map();
    /** Xdebug breakpoint ids per source, so a later request can remove them. */
    private readonly xdebugBreakpointIds = new XdebugBreakpointRegistry();
    private breakpointId = 1;

    // Path mappings for Docker/remote debugging
    private pathMappings: { [key: string]: string } = {};

    // Exception breakpoint settings
    private breakOnAllExceptions = false;

    // Step filter settings
    private skipPhelInternals = true;
    private skipFiles: string[] = [];

    // Xdebug connection
    private server: net.Server | null = null;
    private xdebugSocket: net.Socket | null = null;
    private xdebugPort = 9003;

    // Connection state machine
    private connectionState: ConnectionState = 'listening';

    // DBGp protocol state
    private transactionId = 1;
    private readonly pendingCommands = new XdebugPendingCommands();
    private readonly receiveBuffer = new DbgpMessageReader();

    constructor() {
        super('phel-debug.log');

        this.sourceMapManager = new SourceMapManager();

        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(true);
    }

    /**
     * Initialize the debug session.
     */
    protected initializeRequest(
        response: DebugProtocol.InitializeResponse,
        _args: DebugProtocol.InitializeRequestArguments
    ): void {
        response.body = response.body || {};
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsFunctionBreakpoints = false;
        response.body.supportsConditionalBreakpoints = true;
        response.body.supportsHitConditionalBreakpoints = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsStepBack = false;
        response.body.supportsSetVariable = true;
        response.body.supportsRestartFrame = false;
        response.body.supportsGotoTargetsRequest = false;
        response.body.supportsStepInTargetsRequest = false;
        response.body.supportsCompletionsRequest = false;
        response.body.supportsModulesRequest = false;
        response.body.supportsRestartRequest = false;
        response.body.supportsExceptionOptions = true;
        response.body.supportsValueFormattingOptions = false;
        response.body.supportsExceptionInfoRequest = true;
        response.body.supportTerminateDebuggee = true;
        response.body.supportsDelayedStackTraceLoading = false;
        response.body.supportsLoadedSourcesRequest = false;
        response.body.supportsLogPoints = true;
        response.body.supportsTerminateThreadsRequest = false;
        response.body.supportsSetExpression = false;
        response.body.supportsTerminateRequest = true;

        // One filter, off by default. DBGp breaks where an exception is
        // *thrown* and cannot be asked whether it will be caught — traced
        // against Xdebug 3.4: `breakpoint_set -t exception -x Exception` stops
        // on a `try`/`catch` that handles it perfectly well, while an uncaught
        // exception with no exception breakpoint set does not stop at all. So
        // there is no "uncaught only" to offer. The filter that claimed to be
        // one, and was on by default, stopped every `phel test` run inside the
        // console component's own caught exceptions, before reaching a test.
        response.body.exceptionBreakpointFilters = [
            {
                filter: 'all',
                label: 'All Exceptions',
                description: 'Break wherever a PHP exception or error is thrown, caught or not',
                default: false,
            },
        ];

        this.sendResponse(response);
        this.sendEvent(new InitializedEvent());
    }

    /**
     * Launch the debug session.
     */
    protected async launchRequest(
        response: DebugProtocol.LaunchResponse,
        args: PhelLaunchRequestArguments
    ): Promise<void> {
        // Configure path mappings for Docker/remote debugging
        if (args.pathMappings) {
            this.pathMappings = args.pathMappings;
        }

        // Configure cache directory
        if (args.cacheDir) {
            this.sourceMapManager.addCacheDirectory(args.cacheDir);
        }

        // Add default Phel cache directory (cross-platform)
        const defaultCacheDir = path.join(os.tmpdir(), 'phel', 'cache', 'compiled');
        this.sourceMapManager.addCacheDirectory(defaultCacheDir);

        // Configure step filtering
        this.skipPhelInternals = args.skipPhelInternals !== false; // Default true
        this.skipFiles = args.skipFiles || [];

        this.xdebugPort = args.phpDebugPort || 9003;

        await this.startXdebugServer();

        this.sendEvent(
            new OutputEvent(`Phel debugger listening on port ${this.xdebugPort}\n`, 'console')
        );
        this.sendEvent(new OutputEvent('Waiting for Xdebug connection...\n', 'console'));

        this.sendResponse(response);
    }

    /**
     * Handle configuration done.
     */
    protected configurationDoneRequest(
        response: DebugProtocol.ConfigurationDoneResponse,
        _args: DebugProtocol.ConfigurationDoneArguments
    ): void {
        this.sendResponse(response);
    }

    /**
     * Set exception breakpoints.
     */
    protected setExceptionBreakPointsRequest(
        response: DebugProtocol.SetExceptionBreakpointsResponse,
        args: DebugProtocol.SetExceptionBreakpointsArguments
    ): void {
        this.breakOnAllExceptions = args.filters.includes('all');

        this.sendResponse(response);
    }

    /**
     * Set breakpoints for a file.
     * Uses multi-breakpoint support to set breakpoints on all candidate PHP lines.
     */
    protected async setBreakPointsRequest(
        response: DebugProtocol.SetBreakpointsResponse,
        args: DebugProtocol.SetBreakpointsArguments
    ): Promise<void> {
        const sourcePath = args.source.path;

        if (!sourcePath) {
            response.body = { breakpoints: [] };
            this.sendResponse(response);
            return;
        }

        // DAP sends the complete breakpoint list for a source on every call,
        // so drop whatever the previous call installed before setting the new
        // set — otherwise a removed breakpoint keeps stopping execution.
        this.breakpoints.delete(sourcePath);
        await this.clearXdebugBreakpointsFor(sourcePath);

        const breakpoints: DebugProtocol.Breakpoint[] = [];
        const phelBreakpoints: PhelBreakpoint[] = [];

        if (args.breakpoints) {
            for (const bp of args.breakpoints) {
                const phelLine = bp.line;
                const phelColumn = bp.column; // VS Code may provide column info
                // A logpoint is a breakpoint the engine still stops on; what
                // makes it a logpoint is that we print and resume. Its
                // condition and hit count go to the engine either way.
                const options: BreakpointOptions = {
                    condition: bp.condition,
                    hitCondition: bp.hitCondition,
                };

                let phpFile: string | null = null;
                let phpLine: number | null = null;
                const phpLines: number[] = [];
                let verified = false;
                let candidateCount = 0;
                let rejected: string | undefined;

                if (this.sourceMapManager.isPhelFile(sourcePath)) {
                    // Try multi-breakpoint approach first
                    const candidates = this.sourceMapManager.getBreakpointCandidates(
                        sourcePath,
                        phelLine
                    );

                    if (candidates && candidates.lines.length > 0) {
                        phpFile = candidates.file;
                        candidateCount = candidates.lines.length;

                        // If column is specified, try to use column-aware mapping
                        if (phelColumn !== undefined) {
                            const columnLine = this.sourceMapManager.translateToPhpWithColumn(
                                sourcePath,
                                phelLine,
                                phelColumn
                            );
                            if (columnLine) {
                                phpLine = columnLine.line;
                            }
                        }

                        // Fallback to first candidate if column mapping didn't work
                        if (phpLine === null) {
                            phpLine = candidates.lines[0];
                        }

                        verified = true;
                        phpLines.push(...candidates.lines);
                        if (!phpLines.includes(phpLine)) {
                            phpLines.push(phpLine);
                        }

                        if (this.xdebugSocket) {
                            // Every candidate line gets the same condition and
                            // hit count: the line is one unit in the source, so
                            // it has to behave as one whatever it compiled to.
                            for (const candidateLine of phpLines) {
                                const result = await this.setXdebugBreakpoint(
                                    phpFile,
                                    candidateLine,
                                    sourcePath,
                                    options
                                );
                                rejected ??= result.error;
                            }
                        }
                    } else {
                        // Fallback to simple translation
                        const translation = this.sourceMapManager.translateToPhp(
                            sourcePath,
                            phelLine
                        );
                        if (translation) {
                            phpFile = translation.file;
                            phpLine = translation.line;
                            phpLines.push(phpLine);
                            verified = true;

                            if (this.xdebugSocket) {
                                rejected = (
                                    await this.setXdebugBreakpoint(
                                        phpFile,
                                        phpLine,
                                        sourcePath,
                                        options
                                    )
                                ).error;
                            }
                        }
                    }
                }

                if (rejected) {
                    // The engine refused it outright. Saying so on the
                    // breakpoint beats a filled circle that never fires. (A
                    // condition that is merely invalid PHP is *not* refused:
                    // Xdebug takes it and evaluates it later, so that one can
                    // only fail silently — `docs/debugging.md` says so.)
                    verified = false;
                }

                const breakpoint: PhelBreakpoint = {
                    id: this.breakpointId++,
                    verified,
                    phelFile: sourcePath,
                    phelLine,
                    phpFile,
                    phpLine,
                    phpLines,
                    condition: bp.condition,
                    hitCondition: bp.hitCondition,
                    logMessage: bp.logMessage,
                };

                phelBreakpoints.push(breakpoint);

                // Construct message with candidate info
                let message = 'Source map not found';
                if (rejected) {
                    message = `Xdebug rejected the breakpoint: ${rejected}`;
                } else if (verified && phpFile && phpLine) {
                    message = `Mapped to ${path.basename(phpFile)}:${phpLine}`;
                    if (candidateCount > 1) {
                        message += ` (+${candidateCount - 1} expressions)`;
                    }
                }

                breakpoints.push({
                    id: breakpoint.id,
                    verified: breakpoint.verified,
                    line: phelLine,
                    source: args.source,
                    message,
                });
            }
        }

        this.breakpoints.set(sourcePath, phelBreakpoints);

        response.body = { breakpoints };
        this.sendResponse(response);
    }

    /**
     * Handle threads request.
     */
    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        response.body = {
            threads: [new Thread(PhelDebugSession.THREAD_ID, 'Main Thread')],
        };
        this.sendResponse(response);
    }

    /**
     * Handle stack trace request - translate PHP frames to Phel.
     */
    protected async stackTraceRequest(
        response: DebugProtocol.StackTraceResponse,
        _args: DebugProtocol.StackTraceArguments
    ): Promise<void> {
        const frames: StackFrame[] = [];
        const xdebugFrames = await this.getXdebugStackTrace();

        for (let i = 0; i < xdebugFrames.length; i++) {
            const xframe = xdebugFrames[i];
            let file = this.mapRemoteToLocal(xframe.file);
            let line = xframe.line;
            const name = xframe.name;

            // Try to translate PHP location back to Phel
            if (this.sourceMapManager.isCompiledPhelFile(file)) {
                const translation = this.sourceMapManager.translateToPhel(file, line);
                if (translation) {
                    file = translation.file;
                    line = translation.line;
                }
            }

            frames.push(new StackFrame(i, name, new Source(path.basename(file), file), line));
        }

        response.body = {
            stackFrames: frames,
            totalFrames: frames.length,
        };
        this.sendResponse(response);
    }

    /**
     * Handle scopes request.
     */
    protected scopesRequest(
        response: DebugProtocol.ScopesResponse,
        _args: DebugProtocol.ScopesArguments
    ): void {
        response.body = {
            scopes: [new Scope('Local', 1, false), new Scope('Global', 2, true)],
        };
        this.sendResponse(response);
    }

    /**
     * Handle variables request.
     */
    protected async variablesRequest(
        response: DebugProtocol.VariablesResponse,
        args: DebugProtocol.VariablesArguments
    ): Promise<void> {
        const variables = await this.getXdebugVariables(args.variablesReference);
        response.body = { variables };
        this.sendResponse(response);
    }

    /**
     * Check if we have an active Xdebug connection.
     */
    private requireConnection(operationName: string): boolean {
        if (this.connectionState === 'listening' || !this.xdebugSocket) {
            this.sendEvent(
                new OutputEvent(
                    `⚠️ ${operationName}: No active connection. Refresh browser to trigger new request.\n`,
                    'console'
                )
            );
            return false;
        }
        return true;
    }

    /**
     * Handle continue request.
     */
    protected async continueRequest(
        response: DebugProtocol.ContinueResponse,
        _args: DebugProtocol.ContinueArguments
    ): Promise<void> {
        if (!this.requireConnection('Continue')) {
            response.body = { allThreadsContinued: false };
            this.sendResponse(response);
            return;
        }

        await this.sendXdebugCommand('run');
        response.body = { allThreadsContinued: true };
        this.sendResponse(response);
    }

    /**
     * Handle step over request.
     */
    protected async nextRequest(
        response: DebugProtocol.NextResponse,
        _args: DebugProtocol.NextArguments
    ): Promise<void> {
        if (!this.requireConnection('Step Over')) {
            this.sendResponse(response);
            return;
        }

        await this.sendXdebugCommand('step_over');
        this.sendResponse(response);
    }

    /**
     * Handle step into request.
     */
    protected async stepInRequest(
        response: DebugProtocol.StepInResponse,
        _args: DebugProtocol.StepInArguments
    ): Promise<void> {
        if (!this.requireConnection('Step Into')) {
            this.sendResponse(response);
            return;
        }

        await this.sendXdebugCommand('step_into');
        this.sendResponse(response);
    }

    /**
     * Handle step out request.
     */
    protected async stepOutRequest(
        response: DebugProtocol.StepOutResponse,
        _args: DebugProtocol.StepOutArguments
    ): Promise<void> {
        if (!this.requireConnection('Step Out')) {
            this.sendResponse(response);
            return;
        }

        await this.sendXdebugCommand('step_out');
        this.sendResponse(response);
    }

    /**
     * Handle evaluate request (hover, watch, REPL).
     */
    protected async evaluateRequest(
        response: DebugProtocol.EvaluateResponse,
        args: DebugProtocol.EvaluateArguments
    ): Promise<void> {
        if (!this.requireConnection('Evaluate')) {
            this.sendResponse(response);
            return;
        }

        try {
            const result = await this.evaluatePhel(args.expression);

            response.body = {
                result: result.value,
                type: result.type,
                variablesReference: result.variablesReference,
            };
        } catch (err) {
            // The watch panel and hovers evaluate on their own initiative, on
            // whatever the cursor happens to be over — an out-of-scope name is
            // the normal case there, not an error to shout about. The REPL
            // asked, so it gets the reason.
            const quiet = args.context === 'watch' || args.context === 'hover';
            response.body = {
                result: quiet
                    ? '<not available>'
                    : `Error: ${err instanceof Error ? err.message : String(err)}`,
                variablesReference: 0,
            };
        }

        this.sendResponse(response);
    }

    /**
     * Evaluate a Phel expression in the frame the engine is stopped in.
     * Rejects when Xdebug reports an error (`parseEvalResult` throws).
     */
    private async evaluatePhel(expression: string): Promise<{
        value: string;
        type: string;
        variablesReference: number;
    }> {
        const xml = await this.sendXdebugCommand('eval', {}, phelExpressionToPhp(expression));
        return this.parseEvalResult(xml);
    }

    /**
     * Parse eval result from Xdebug.
     */
    private parseEvalResult(xml: string): {
        value: string;
        type: string;
        variablesReference: number;
    } {
        // Check for error
        const errorMatch = xml.match(
            /<error[^>]*code="(\d+)"[^>]*><message><!\[CDATA\[(.*?)\]\]><\/message>/s
        );
        if (errorMatch) {
            throw new Error(decodeDbgpCdata(errorMatch[2], errorMatch[0]));
        }

        // Parse property
        const typeMatch = xml.match(/type="([^"]*)"/);
        const classnameMatch = xml.match(/classname="([^"]*)"/);
        const childrenMatch = xml.match(/children="(\d+)"/);
        const numchildrenMatch = xml.match(/numchildren="(\d+)"/);
        const cdataMatch = xml.match(/<!\[CDATA\[(.*?)\]\]>/s);
        const fullnameMatch = xml.match(/fullname="([^"]*)"/);

        const type = typeMatch ? typeMatch[1] : 'unknown';
        const classname = classnameMatch ? classnameMatch[1] : '';
        const hasChildren = childrenMatch ? childrenMatch[1] === '1' : false;
        const numChildren = numchildrenMatch ? parseInt(numchildrenMatch[1], 10) : 0;
        const value = cdataMatch ? decodeDbgpCdata(cdataMatch[1], xml) : '';
        const fullname = fullnameMatch ? fullnameMatch[1] : '';

        // Create variable reference for expandable items
        let variablesReference = 0;
        if (hasChildren || numChildren > 0) {
            variablesReference = this.variableRefCounter++;
            this.variableRefs.set(variablesReference, fullname);
        }

        return {
            value: this.formatPhelValue(type, classname, value, numChildren),
            type: this.formatPhelType(type, classname),
            variablesReference,
        };
    }

    /**
     * Handle disconnect request.
     */
    protected disconnectRequest(
        response: DebugProtocol.DisconnectResponse,
        _args: DebugProtocol.DisconnectArguments
    ): void {
        this.cleanup();
        this.sendResponse(response);
    }

    /**
     * Handle terminate request.
     */
    protected terminateRequest(
        response: DebugProtocol.TerminateResponse,
        _args: DebugProtocol.TerminateArguments
    ): void {
        this.cleanup();
        this.sendResponse(response);
        // `terminate` is the graceful stop, so the editor waits for the adapter
        // to say the debuggee is gone. Once the listener is closed there is
        // nothing left to wait for; without this the session lingers in the UI.
        this.sendEvent(new TerminatedEvent());
    }

    // ==================== Path Mapping ====================

    /**
     * Map a remote path (Docker/server) to a local path.
     */
    private mapRemoteToLocal(remotePath: string): string {
        for (const [remote, local] of Object.entries(this.pathMappings)) {
            if (remotePath.startsWith(remote)) {
                return remotePath.replace(remote, local);
            }
        }
        return remotePath;
    }

    /**
     * Map a local path to a remote path (Docker/server).
     */
    private mapLocalToRemote(localPath: string): string {
        for (const [remote, local] of Object.entries(this.pathMappings)) {
            if (localPath.startsWith(local)) {
                return localPath.replace(local, remote);
            }
        }
        return localPath;
    }

    // ==================== Xdebug Integration ====================

    /**
     * Start the Xdebug listener server.
     */
    private startXdebugServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = net.createServer((socket) => {
                this.handleXdebugConnection(socket);
            });

            this.server.on('error', (err) => {
                this.sendEvent(new OutputEvent(`Server error: ${err.message}\n`, 'stderr'));
                reject(err);
            });

            this.server.listen(this.xdebugPort, () => {
                resolve();
            });
        });
    }

    /**
     * Handle a new Xdebug connection.
     */
    private handleXdebugConnection(socket: net.Socket): void {
        this.xdebugSocket = socket;
        this.connectionState = 'connected';
        this.sendEvent(new OutputEvent('Xdebug connected!\n', 'console'));

        socket.on('data', (data) => {
            this.handleXdebugData(data);
        });

        socket.on('close', () => {
            this.xdebugSocket = null;
            this.receiveBuffer.reset();
            this.transactionId = 1;
            // Settle anything still in flight. Clearing the map without
            // settling left the caller awaiting a promise that could never
            // resolve: the 30s timeout only fires for ids still present, so it
            // saw the entry gone and did nothing.
            this.pendingCommands.settleAll();
            // Breakpoint ids belong to the engine session that just ended. The
            // next connection re-applies every breakpoint and gets fresh ids,
            // so holding the old ones would grow the map on every request and
            // aim removals at a session that no longer exists.
            this.xdebugBreakpointIds.clear();
            this.connectionState = 'listening';
            this.sendEvent(
                new OutputEvent('Request completed. Waiting for next connection...\n', 'console')
            );
        });

        socket.on('error', (err) => {
            this.sendEvent(new OutputEvent(`Xdebug error: ${err.message}\n`, 'stderr'));
        });
    }

    /**
     * Handle data received from Xdebug.
     */
    private handleXdebugData(data: Buffer): void {
        // Framing lives in DbgpMessageReader: the length prefix counts bytes,
        // and a chunk can split a multi-byte character, so the buffering has to
        // stay in Buffers and decode only complete payloads.
        for (const xml of this.receiveBuffer.push(data)) {
            this.handleXdebugMessage(xml);
        }
    }

    /**
     * Handle a single Xdebug message.
     */
    private handleXdebugMessage(xml: string): void {
        if (xml.includes('<init ')) {
            this.onXdebugInit(xml);
        } else if (xml.includes('<response ')) {
            this.onXdebugResponse(xml);
        } else if (xml.includes('<stream ')) {
            this.onXdebugStream(xml);
        }
    }

    /**
     * Handle Xdebug init message.
     */
    private async onXdebugInit(_xml: string): Promise<void> {
        // Set up the debugging session
        await this.sendXdebugCommand('feature_set', { n: 'show_hidden', v: '1' });
        await this.sendXdebugCommand('feature_set', { n: 'max_children', v: '100' });
        await this.sendXdebugCommand('feature_set', { n: 'max_data', v: '2048' });
        await this.sendXdebugCommand('feature_set', { n: 'max_depth', v: '3' });

        // Set exception breakpoints
        await this.applyExceptionBreakpoints();

        // Clear source map cache - PHP files were just compiled
        this.sourceMapManager.clearCache();

        // Apply all breakpoints
        await this.applyAllBreakpoints();

        this.connectionState = 'running';

        // Start execution
        await this.sendXdebugCommand('run');
    }

    /**
     * Apply exception breakpoint settings to Xdebug.
     *
     * `-x *` covers both hierarchies (`Exception` and `Error`) in one
     * breakpoint. Nothing is installed unless the filter is on: see the note
     * on `exceptionBreakpointFilters`.
     */
    private async applyExceptionBreakpoints(): Promise<void> {
        if (!this.breakOnAllExceptions) {
            return;
        }
        try {
            await this.sendXdebugCommand('breakpoint_set', {
                t: 'exception',
                x: '*', // All exceptions
            });
        } catch {
            // Exception breakpoints might not be supported in all Xdebug versions
        }
    }

    /**
     * Apply all stored breakpoints to Xdebug.
     * Uses smart line selection and retry logic for unresolved breakpoints.
     */
    private async applyAllBreakpoints(): Promise<void> {
        let successCount = 0;
        let failCount = 0;

        for (const [, breakpoints] of this.breakpoints) {
            for (const bp of breakpoints) {
                let success = false;
                const options: BreakpointOptions = {
                    condition: bp.condition,
                    hitCondition: bp.hitCondition,
                };
                bp.phpLines = [];

                // Get candidate lines for this breakpoint
                const candidates = this.sourceMapManager.getBreakpointCandidates(
                    bp.phelFile,
                    bp.phelLine
                );

                if (candidates) {
                    bp.phpFile = candidates.file;

                    // Try each candidate line until one is resolved
                    for (const candidateLine of candidates.lines) {
                        try {
                            const result = await this.setXdebugBreakpoint(
                                candidates.file,
                                candidateLine,
                                bp.phelFile,
                                options
                            );
                            if (result.ok) {
                                bp.phpLines.push(candidateLine);
                                if (!success) {
                                    bp.phpLine = candidateLine;
                                    success = true;
                                }
                            }
                        } catch {
                            // Try next candidate
                        }
                    }
                } else {
                    // Fallback to simple translation
                    const translation = this.sourceMapManager.translateToPhp(
                        bp.phelFile,
                        bp.phelLine
                    );
                    if (translation) {
                        bp.phpFile = translation.file;
                        bp.phpLine = translation.line;
                        try {
                            success = (
                                await this.setXdebugBreakpoint(
                                    translation.file,
                                    translation.line,
                                    bp.phelFile,
                                    options
                                )
                            ).ok;
                            if (success) {
                                bp.phpLines.push(translation.line);
                            }
                        } catch {
                            // Ignore
                        }
                    }
                }

                if (success) {
                    bp.verified = true;
                    successCount++;
                    const bpEvent = new BreakpointEvent(
                        'changed',
                        new Breakpoint(true, bp.phelLine)
                    );
                    (bpEvent.body.breakpoint as DebugProtocol.Breakpoint).id = bp.id;
                    this.sendEvent(bpEvent);
                } else {
                    failCount++;
                }
            }
        }

        if (successCount > 0 || failCount > 0) {
            this.sendEvent(
                new OutputEvent(
                    `Breakpoints: ${successCount} set, ${failCount} failed\n`,
                    'console'
                )
            );
        }
    }

    /**
     * Handle Xdebug response message.
     */
    private onXdebugResponse(xml: string): void {
        // Extract transaction_id and resolve pending command
        const tidMatch = xml.match(/transaction_id="(\d+)"/);
        if (tidMatch) {
            const tid = parseInt(tidMatch[1], 10);
            this.pendingCommands.settle(tid, xml);
        }

        // Check status
        const statusMatch = xml.match(/status="([^"]+)"/);
        if (statusMatch) {
            const status = statusMatch[1];

            if (status === 'break') {
                this.handleBreakEvent(xml).catch(() => {});
            } else if (status === 'stopping') {
                // Let Xdebug finish so HTTP response is sent
                this.sendXdebugCommand('run').catch(() => {});
            }
        }
    }

    /**
     * Handle break event - checks step filters, then logpoints.
     */
    private async handleBreakEvent(xml: string): Promise<void> {
        // Get current file from stack trace
        const frames = await this.getXdebugStackTrace();
        if (frames.length > 0) {
            const currentFile = frames[0].file;

            // Check if we should skip this file
            if (this.shouldSkipFile(currentFile)) {
                // Auto-step out of this file
                await this.sendXdebugCommand('step_out');
                return;
            }
        }

        const logMessage = this.breakpointAt(xml)?.logMessage;
        if (logMessage !== undefined) {
            // A logpoint never stops: it prints from the frame it is standing
            // in — which is the only place its `{expressions}` can be read —
            // and lets execution go on.
            await this.printLogPoint(logMessage);
            await this.sendXdebugCommand('run');
            return;
        }

        this.sendEvent(new OutputEvent('🛑 Breakpoint hit!\n', 'console'));
        this.sendEvent(new StoppedEvent('breakpoint', PhelDebugSession.THREAD_ID));
    }

    /**
     * Which of our breakpoints the engine stopped on, when it says where.
     *
     * DBGp reports the location, never the breakpoint id, so the answer comes
     * from the PHP lines each breakpoint was installed on. Both sides go
     * through `normalizePath` because the URI we sent was a resolved path and
     * the one coming back is whatever PHP included.
     */
    private breakpointAt(xml: string): PhelBreakpoint | undefined {
        const at = parseBreakLocation(xml);
        if (!at) {
            return undefined;
        }
        const file = this.normalizePath(this.mapRemoteToLocal(this.fromFileUri(at.fileUri)));
        const installed = [...this.breakpoints.values()].flat().map((bp) => ({
            phpFile: bp.phpFile === null ? null : this.normalizePath(bp.phpFile),
            phpLines: bp.phpLines,
            breakpoint: bp,
        }));
        return matchBreakpoint(installed, file, at.line)?.breakpoint;
    }

    /**
     * Print a logpoint's message, with every `{expression}` in it evaluated in
     * the frame execution is paused in. A failing expression prints its reason
     * inline rather than swallowing the whole line.
     */
    private async printLogPoint(template: string): Promise<void> {
        const text = await interpolateLogMessage(template, async (expression) => {
            try {
                return (await this.evaluatePhel(expression)).value;
            } catch (err) {
                return `<${err instanceof Error ? err.message : String(err)}>`;
            }
        });
        this.sendEvent(new OutputEvent(text + '\n', 'console'));
    }

    /**
     * Check if a file should be skipped during stepping.
     */
    private shouldSkipFile(filePath: string): boolean {
        // Skip Phel internals if enabled
        if (this.skipPhelInternals) {
            const lowerPath = filePath.toLowerCase();
            if (
                lowerPath.includes('/phel-lang/phel-lang/src/php/') ||
                lowerPath.includes('/phel-lang/src/php/') ||
                lowerPath.includes('\\phel-lang\\phel-lang\\src\\php\\') ||
                lowerPath.includes('\\phel-lang\\src\\php\\')
            ) {
                return true;
            }
        }

        // Check custom skip patterns
        for (const pattern of this.skipFiles) {
            if (this.matchesGlob(filePath, pattern)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Simple glob pattern matching.
     */
    private matchesGlob(filePath: string, pattern: string): boolean {
        // Convert glob to regex
        const regex = pattern
            .replace(/\./g, '\\.')
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/\\\\]*')
            .replace(/\?/g, '.');

        return new RegExp(regex, 'i').test(filePath);
    }

    /**
     * Handle Xdebug stream message.
     */
    private onXdebugStream(xml: string): void {
        const typeMatch = xml.match(/type="([^"]+)"/);
        const type = typeMatch ? typeMatch[1] : 'stdout';

        const cdataMatch = xml.match(/<!\[CDATA\[(.*?)\]\]>/s);
        if (cdataMatch) {
            const content = decodeDbgpCdata(cdataMatch[1], xml);
            this.sendEvent(new OutputEvent(content, type));
        }
    }

    /**
     * Send a command to Xdebug.
     * @param command The DBGp command name
     * @param args Key-value pairs for command arguments
     * @param data Optional data payload (will be base64 encoded)
     */
    private sendXdebugCommand(
        command: string,
        args: { [key: string]: string } = {},
        data?: string
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this.xdebugSocket) {
                reject(new Error('Not connected to Xdebug'));
                return;
            }

            const tid = this.transactionId++;
            // The NUL terminates the frame; the command itself is protocol.
            const cmd = formatDbgpCommand(command, tid, args, data) + '\0';

            this.pendingCommands.add(tid, resolve);
            this.xdebugSocket.write(cmd);

            setTimeout(() => {
                if (this.pendingCommands.abandon(tid)) {
                    reject(new Error('Command timeout'));
                }
            }, 30000);
        });
    }

    /**
     * Normalize a file path by resolving symlinks.
     */
    private normalizePath(filePath: string): string {
        try {
            return fs.realpathSync(filePath);
        } catch {
            return path.normalize(filePath);
        }
    }

    /**
     * Convert a file path to a file:// URI (cross-platform).
     */
    private toFileUri(filePath: string): string {
        const normalized = this.normalizePath(filePath);

        // Windows: file:///C:/path/to/file
        // Unix: file:///path/to/file
        if (process.platform === 'win32') {
            return 'file:///' + normalized.replace(/\\/g, '/');
        }
        return 'file://' + normalized;
    }

    /**
     * Convert a file:// URI to a file path (cross-platform).
     */
    private fromFileUri(uri: string): string {
        let filePath = uri.replace(/^file:\/\//, '');

        // Windows: file:///C:/path -> C:/path
        if (process.platform === 'win32' && filePath.startsWith('/')) {
            filePath = filePath.substring(1);
        }

        return decodeURIComponent(filePath);
    }

    /**
     * Set a breakpoint in Xdebug, with its condition and hit count when it has
     * them. A condition travels as the data payload of a `conditional`
     * breakpoint; a hit count as `-h`/`-o` on either kind.
     */
    private async setXdebugBreakpoint(
        file: string,
        line: number,
        sourcePath?: string,
        options: BreakpointOptions = {}
    ): Promise<BreakpointSetResult> {
        const remoteFile = this.mapLocalToRemote(file);
        const fileUri = this.toFileUri(remoteFile);

        const command = breakpointSetArgs(fileUri, line, options);
        const response = await this.sendXdebugCommand('breakpoint_set', command.args, command.data);

        const result = parseBreakpointSetResponse(response);

        if (result.id && sourcePath) {
            // Remember it so the next `setBreakpoints` for this file can clear it.
            this.xdebugBreakpointIds.record(sourcePath, result.id);
        }

        return result;
    }

    /**
     * Remove every Xdebug breakpoint previously installed for a source file.
     *
     * Without this, a breakpoint deleted or moved in the editor stayed live in
     * the engine and kept stopping execution on a line showing no breakpoint —
     * and each toggle installed another one, on every candidate line.
     */
    private async clearXdebugBreakpointsFor(sourcePath: string): Promise<void> {
        const ids = this.xdebugBreakpointIds.take(sourcePath);
        if (ids.length === 0 || !this.xdebugSocket) {
            return;
        }
        for (const id of ids) {
            try {
                await this.sendXdebugCommand('breakpoint_remove', { d: id });
            } catch {
                // The engine may already have dropped it (script ended, or the
                // breakpoint was never resolved); nothing to recover here.
            }
        }
    }

    /**
     * Get stack trace from Xdebug.
     */
    private async getXdebugStackTrace(): Promise<
        Array<{ file: string; line: number; name: string }>
    > {
        const frames: Array<{ file: string; line: number; name: string }> = [];

        try {
            const response = await this.sendXdebugCommand('stack_get');

            const stackRegex = /<stack\s+([^>]+)>/g;
            let match;

            while ((match = stackRegex.exec(response)) !== null) {
                const attrs = match[1];

                const filenameMatch = attrs.match(/filename="([^"]+)"/);
                const linenoMatch = attrs.match(/lineno="(\d+)"/);
                const whereMatch = attrs.match(/where="([^"]*)"/);

                if (filenameMatch && linenoMatch) {
                    const file = this.fromFileUri(filenameMatch[1]);
                    const line = parseInt(linenoMatch[1], 10);
                    const name = whereMatch ? whereMatch[1] : '<anonymous>';

                    frames.push({ file, line, name });
                }
            }
        } catch {
            // Ignore errors
        }

        return frames;
    }

    // Variable reference counter for nested objects
    private variableRefCounter = 100;
    private variableRefs: Map<number, string> = new Map();

    /**
     * Get variables from Xdebug.
     */
    private async getXdebugVariables(
        variablesReference: number
    ): Promise<DebugProtocol.Variable[]> {
        const variables: DebugProtocol.Variable[] = [];

        try {
            let response: string;

            // Check if this is a nested variable reference
            const fullName = this.variableRefs.get(variablesReference);
            if (fullName) {
                // Get property by full name
                response = await this.sendXdebugCommand('property_get', {
                    n: fullName,
                });
            } else {
                // Get context (local = 0, global = 1)
                const context = variablesReference === 1 ? 0 : 1;
                response = await this.sendXdebugCommand('context_get', {
                    c: context.toString(),
                });
            }

            // Parse properties recursively
            this.parseXdebugProperties(response, variables);
        } catch {
            // Ignore errors
        }

        return variables;
    }

    /**
     * Parse Xdebug property XML into VS Code variables.
     */
    private parseXdebugProperties(xml: string, variables: DebugProtocol.Variable[]): void {
        // Match property elements with their attributes and content
        const propRegex = /<property\s+([^>]*)(?:\/>|>([\s\S]*?)<\/property>)/g;
        let match;

        while ((match = propRegex.exec(xml)) !== null) {
            const attrs = match[1];
            const content = match[2] || '';

            // Extract attributes
            const nameMatch = attrs.match(/name="([^"]*)"/);
            const fullnameMatch = attrs.match(/fullname="([^"]*)"/);
            const typeMatch = attrs.match(/type="([^"]*)"/);
            const classnameMatch = attrs.match(/classname="([^"]*)"/);
            const childrenMatch = attrs.match(/children="(\d+)"/);
            const numchildrenMatch = attrs.match(/numchildren="(\d+)"/);

            const name = nameMatch ? this.decodeXdebugValue(nameMatch[1]) : '?';
            const fullname = fullnameMatch ? fullnameMatch[1] : name;
            const type = typeMatch ? typeMatch[1] : 'unknown';
            const classname = classnameMatch ? classnameMatch[1] : '';
            const hasChildren = childrenMatch ? childrenMatch[1] === '1' : false;
            const numChildren = numchildrenMatch ? parseInt(numchildrenMatch[1], 10) : 0;

            // Get value from CDATA
            let value = '';
            const cdataMatch = content.match(/<!\[CDATA\[(.*?)\]\]>/s);
            if (cdataMatch) {
                value = decodeDbgpCdata(cdataMatch[1], content);
            }

            // Format the display value
            const displayValue = this.formatPhelValue(type, classname, value, numChildren);
            const displayType = this.formatPhelType(type, classname);

            // Create variable reference for expandable items
            let variablesReference = 0;
            if (hasChildren || numChildren > 0) {
                variablesReference = this.variableRefCounter++;
                this.variableRefs.set(variablesReference, fullname);
            }

            variables.push({
                name: this.formatVariableName(name),
                value: displayValue,
                type: displayType,
                variablesReference,
            });
        }
    }

    /**
     * Format a Phel-friendly variable name.
     */
    private formatVariableName(name: string): string {
        // Convert PHP variable names to Phel style
        // $foo_bar -> foo-bar
        return name
            .replace(/^\$/, '')
            .replace(/_(\d+)$/, '') // Remove numeric suffixes
            .replace(/_/g, '-');
    }

    /**
     * Format Phel type for display.
     */
    private formatPhelType(type: string, classname: string): string {
        if (classname) {
            // Map PHP class names to Phel types
            if (classname.includes('PersistentVector')) {
                return 'vector';
            }
            if (classname.includes('PersistentMap')) {
                return 'map';
            }
            if (classname.includes('PersistentList')) {
                return 'list';
            }
            if (classname.includes('Keyword')) {
                return 'keyword';
            }
            if (classname.includes('Symbol')) {
                return 'symbol';
            }
            if (classname.includes('AbstractFn')) {
                return 'function';
            }
            if (classname.includes('Set')) {
                return 'set';
            }
            return classname.split('\\').pop() || classname;
        }
        return type;
    }

    /**
     * Format Phel value for display.
     */
    private formatPhelValue(
        type: string,
        classname: string,
        value: string,
        numChildren: number
    ): string {
        // Handle Phel-specific types
        if (classname) {
            if (classname.includes('PersistentVector')) {
                return `[${numChildren} items]`;
            }
            if (classname.includes('PersistentMap')) {
                return `{${numChildren / 2} entries}`;
            }
            if (classname.includes('PersistentList')) {
                return `(${numChildren} items)`;
            }
            if (classname.includes('Keyword')) {
                return `:${value || '?'}`;
            }
            if (classname.includes('Symbol')) {
                return value || '?';
            }
            if (classname.includes('Set')) {
                return `#{${numChildren} items}`;
            }
        }

        // Handle basic types
        switch (type) {
            case 'string':
                return `"${value}"`;
            case 'int':
            case 'float':
                return value;
            case 'bool':
                return value === '1' ? 'true' : 'false';
            case 'null':
                return 'nil';
            case 'array':
                return `[${numChildren} items]`;
            case 'object':
                return classname ? `<${classname.split('\\').pop()}>` : '<object>';
            default:
                return value || `(${type})`;
        }
    }

    /**
     * Decode Xdebug-encoded value.
     */
    private decodeXdebugValue(value: string): string {
        // Xdebug sometimes encodes special characters
        return value
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"');
    }

    /**
     * Clean up resources.
     */
    private cleanup(): void {
        if (this.xdebugSocket) {
            try {
                this.sendXdebugCommand('stop').catch(() => {
                    /* ignore */
                });
            } catch {
                // Ignore errors during cleanup
            }
            this.xdebugSocket.destroy();
            this.xdebugSocket = null;
        }

        this.xdebugBreakpointIds.clear();
        // Disconnect can arrive while commands are in flight; unblock them.
        this.pendingCommands.settleAll();

        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }
}
