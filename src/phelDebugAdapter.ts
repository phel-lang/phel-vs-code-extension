import {
    LoggingDebugSession,
    InitializedEvent,
    StoppedEvent,
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
    private breakOnUncaughtExceptions = true;

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
    private pendingCommands: Map<number, (response: string) => void> = new Map();
    private receiveBuffer = '';

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
        response.body.supportsConditionalBreakpoints = false;
        response.body.supportsHitConditionalBreakpoints = false;
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
        response.body.supportsLogPoints = false;
        response.body.supportsTerminateThreadsRequest = false;
        response.body.supportsSetExpression = false;
        response.body.supportsTerminateRequest = true;

        // Exception breakpoint filters
        response.body.exceptionBreakpointFilters = [
            {
                filter: 'all',
                label: 'All Exceptions',
                description: 'Break on all PHP exceptions',
                default: false,
            },
            {
                filter: 'uncaught',
                label: 'Uncaught Exceptions',
                description: 'Break on uncaught PHP exceptions',
                default: true,
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
        this.breakOnUncaughtExceptions = args.filters.includes('uncaught');

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

                let phpFile: string | null = null;
                let phpLine: number | null = null;
                let verified = false;
                let candidateCount = 0;

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

                        if (this.xdebugSocket) {
                            // Set breakpoint on the primary line
                            await this.setXdebugBreakpoint(phpFile, phpLine, sourcePath);

                            // Also set breakpoints on other candidates for multi-expression lines
                            for (const candidateLine of candidates.lines) {
                                if (candidateLine !== phpLine) {
                                    await this.setXdebugBreakpoint(
                                        phpFile,
                                        candidateLine,
                                        sourcePath
                                    );
                                }
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
                            verified = true;

                            if (this.xdebugSocket) {
                                await this.setXdebugBreakpoint(phpFile, phpLine, sourcePath);
                            }
                        }
                    }
                }

                const breakpoint: PhelBreakpoint = {
                    id: this.breakpointId++,
                    verified,
                    phelFile: sourcePath,
                    phelLine,
                    phpFile,
                    phpLine,
                };

                phelBreakpoints.push(breakpoint);

                // Construct message with candidate info
                let message = 'Source map not found';
                if (verified && phpFile && phpLine) {
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
            // Convert Phel-style names to PHP
            const phpExpression = this.convertPhelToPHP(args.expression);

            const xdebugResponse = await this.sendXdebugCommand('eval', {}, phpExpression);

            // Parse the result
            const result = this.parseEvalResult(xdebugResponse);

            response.body = {
                result: result.value,
                type: result.type,
                variablesReference: result.variablesReference,
            };
        } catch (err) {
            // Evaluation failed - return error message
            response.body = {
                result: `Error: ${err instanceof Error ? err.message : String(err)}`,
                variablesReference: 0,
            };
        }

        this.sendResponse(response);
    }

    /**
     * Convert Phel-style expression to PHP.
     * Examples: foo-bar -> $foo_bar, :keyword -> new Keyword('keyword')
     */
    private convertPhelToPHP(expression: string): string {
        let php = expression.trim();

        // If it looks like a variable reference (kebab-case identifier)
        if (/^[a-z][a-z0-9-]*$/i.test(php)) {
            // Convert kebab-case to snake_case and add $
            php = '$' + php.replace(/-/g, '_');
        }
        // If it's a keyword
        else if (php.startsWith(':')) {
            const name = php.substring(1);
            php = `new \\Phel\\Lang\\Keyword("${name}")`;
        }
        // Already looks like PHP

        return php;
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
            throw new Error(Buffer.from(errorMatch[2], 'base64').toString('utf-8'));
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
        const value = cdataMatch ? Buffer.from(cdataMatch[1], 'base64').toString('utf-8') : '';
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
            this.handleXdebugData(data.toString());
        });

        socket.on('close', () => {
            this.xdebugSocket = null;
            this.receiveBuffer = '';
            this.transactionId = 1;
            this.pendingCommands.clear();
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
    private handleXdebugData(data: string): void {
        this.receiveBuffer += data;

        // DBGp messages are length-prefixed: "length\0xml\0"
        let nullIndex = this.receiveBuffer.indexOf('\0');
        while (nullIndex !== -1) {
            const lengthStr = this.receiveBuffer.substring(0, nullIndex);
            const length = parseInt(lengthStr, 10);

            if (isNaN(length)) {
                this.receiveBuffer = '';
                break;
            }

            const totalLength = nullIndex + 1 + length + 1;
            if (this.receiveBuffer.length < totalLength) {
                break;
            }

            const xml = this.receiveBuffer.substring(nullIndex + 1, nullIndex + 1 + length);
            this.receiveBuffer = this.receiveBuffer.substring(totalLength);

            this.handleXdebugMessage(xml);
            nullIndex = this.receiveBuffer.indexOf('\0');
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
     */
    private async applyExceptionBreakpoints(): Promise<void> {
        // Remove existing exception breakpoints
        try {
            // Set breakpoint on all exceptions if enabled
            if (this.breakOnAllExceptions) {
                await this.sendXdebugCommand('breakpoint_set', {
                    t: 'exception',
                    x: '*', // All exceptions
                });
            } else if (this.breakOnUncaughtExceptions) {
                // Xdebug breaks on uncaught exceptions by default, but we can be explicit
                await this.sendXdebugCommand('breakpoint_set', {
                    t: 'exception',
                    x: 'Error', // PHP 7+ Error class
                });
                await this.sendXdebugCommand('breakpoint_set', {
                    t: 'exception',
                    x: 'Exception', // Base Exception class
                });
            }
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
                            success = await this.setXdebugBreakpoint(
                                candidates.file,
                                candidateLine,
                                bp.phelFile
                            );
                            if (success) {
                                bp.phpLine = candidateLine;
                                break;
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
                            success = await this.setXdebugBreakpoint(
                                translation.file,
                                translation.line,
                                bp.phelFile
                            );
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
            const callback = this.pendingCommands.get(tid);
            if (callback) {
                this.pendingCommands.delete(tid);
                callback(xml);
            }
        }

        // Check status
        const statusMatch = xml.match(/status="([^"]+)"/);
        if (statusMatch) {
            const status = statusMatch[1];

            if (status === 'break') {
                this.handleBreakEvent().catch(() => {});
            } else if (status === 'stopping') {
                // Let Xdebug finish so HTTP response is sent
                this.sendXdebugCommand('run').catch(() => {});
            }
        }
    }

    /**
     * Handle break event - checks step filters.
     */
    private async handleBreakEvent(): Promise<void> {
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

        this.sendEvent(new OutputEvent('🛑 Breakpoint hit!\n', 'console'));
        this.sendEvent(new StoppedEvent('breakpoint', PhelDebugSession.THREAD_ID));
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
            const content = Buffer.from(cdataMatch[1], 'base64').toString('utf-8');
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
            let cmd = `${command} -i ${tid}`;

            for (const [key, value] of Object.entries(args)) {
                cmd += ` -${key} ${value}`;
            }

            // Add base64-encoded data payload if provided
            if (data) {
                const encoded = Buffer.from(data).toString('base64');
                cmd += ` -- ${encoded}`;
            }

            cmd += '\0';

            this.pendingCommands.set(tid, resolve);
            this.xdebugSocket.write(cmd);

            setTimeout(() => {
                if (this.pendingCommands.has(tid)) {
                    this.pendingCommands.delete(tid);
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
     * Set a breakpoint in Xdebug.
     */
    private async setXdebugBreakpoint(
        file: string,
        line: number,
        sourcePath?: string
    ): Promise<boolean> {
        const remoteFile = this.mapLocalToRemote(file);
        const fileUri = this.toFileUri(remoteFile);

        const response = await this.sendXdebugCommand('breakpoint_set', {
            t: 'line',
            f: fileUri,
            n: line.toString(),
        });

        const idMatch = response.match(/id="(\d+)"/);
        const resolvedMatch = response.match(/resolved="(\d+)"/);
        const stateMatch = response.match(/state="([^"]+)"/);

        const resolved = resolvedMatch ? resolvedMatch[1] === '1' : false;
        const state = stateMatch ? stateMatch[1] : 'unknown';

        if (idMatch && sourcePath) {
            // Remember it so the next `setBreakpoints` for this file can clear it.
            this.xdebugBreakpointIds.record(sourcePath, idMatch[1]);
        }

        return idMatch !== null && (resolved || state === 'enabled');
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
                value = Buffer.from(cdataMatch[1], 'base64').toString('utf-8');
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

        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }
}
