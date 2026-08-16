// Language Server Protocol client.
//
// phel-lang ships a full LSP v3.17 server (`phel lsp`, stdio, JSON-RPC 2.0
// with Content-Length framing) backed by the same semantic analyzer the
// compiler uses. When enabled (the default), we spawn it and delegate
// completion, hover, signature help, go-to-definition, find-references,
// rename, document/workspace symbols, formatting, and diagnostics to it —
// gaining PHP-interop intelligence (reflection over `php/->`, `php/::`,
// `php/new`) and semantically scoped rename/references that the bundled
// TypeScript providers cannot match.
//
// The client probes whether `phel lsp` is runnable; if the installed Phel is
// too old to know the command (or the spawn fails), it reports failure so the
// caller can fall back to the in-TypeScript providers.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    CloseAction,
    type CloseHandlerResult,
    ErrorAction,
    type ErrorHandler,
    type ErrorHandlerResult,
    type Executable,
    LanguageClient,
    type LanguageClientOptions,
    type Message,
    type ServerOptions,
    State,
    TransportKind,
} from 'vscode-languageclient/node';
import { resolvePhelExecutable } from './phelExecutable';
import { toInvocation } from './phelInvocation';
import { LspRestartBudget } from './lspRestartBudget';

const OUTPUT_CHANNEL_NAME = 'Phel Language Server';

// The Phel server is a short-lived stdio process: it can exit between requests
// (e.g. it returns 0 on an idle read). Transparently restart it a bounded
// number of times so language features keep working without a reload, while
// still giving up on a genuinely broken (or chronically idle-exiting) server
// to avoid a spawn loop — at which point we hand off to the bundled providers.
const MAX_SERVER_RESTARTS = 5;
const RESTART_WINDOW_MS = 60_000;

let client: LanguageClient | undefined;
let outputChannel: vscode.OutputChannel | undefined;
/** Invoked once when the server proves unusable, so the caller can fall back. */
let onUnrecoverable: (() => void) | undefined;
let gaveUp = false;

export function isLanguageServerEnabled(): boolean {
    // Opt-in: current `phel lsp` builds can exit on idle, so default off until upstream is stable.
    return vscode.workspace.getConfiguration('phel').get<boolean>('lsp.enabled', false);
}

export function isLanguageServerRunning(): boolean {
    return client !== undefined && client.state === State.Running;
}

/**
 * Resolve the command + args used to launch the language server. The command
 * follows the same precedence as every other Phel subsystem
 * (`phel.lsp.command` → `phel.executablePath` → `vendor/bin/phel`); extra
 * server args come from `phel.lsp.args` (default `["lsp"]`).
 */
function resolveServerCommand(folder: vscode.WorkspaceFolder | undefined): {
    command: string;
    args: string[];
} {
    const config = vscode.workspace.getConfiguration('phel', folder);
    const override = config.get<string>('lsp.command', '');
    let command: string;
    if (override && override.length > 0) {
        command = path.isAbsolute(override)
            ? override
            : path.resolve(folder?.uri.fsPath ?? process.cwd(), override);
    } else {
        command = resolvePhelExecutable('lsp.command', folder);
    }
    const args = config.get<string[]>('lsp.args', ['lsp']);
    return { command, args: [...args] };
}

/**
 * Start the language client. Returns true when the server was launched and
 * reached the running state, false when it could not be started (so the
 * caller can fall back to the bundled providers).
 *
 * `options.onUnrecoverable` is invoked at most once if the server later proves
 * unusable (repeated crashes / idle-exits), so the caller can register the
 * bundled providers as a permanent fallback for the session.
 */
export async function startLanguageClient(
    context: vscode.ExtensionContext,
    options: { onUnrecoverable?: () => void } = {}
): Promise<boolean> {
    if (options.onUnrecoverable) {
        onUnrecoverable = options.onUnrecoverable;
    }
    if (client) {
        return isLanguageServerRunning();
    }

    // One server per window, rooted at the first folder: `phel lsp` has no
    // multi-root notion, and a client per folder would mean one process (and
    // one compiler cache) per folder. Known limitation, documented in
    // docs/settings.md.
    const folder = vscode.workspace.workspaceFolders?.[0];
    const { command, args } = resolveServerCommand(folder);

    // A relative path that doesn't resolve to a real file means Phel isn't
    // installed where we expect; bail quietly so the TS providers take over.
    if (path.isAbsolute(command) && !fs.existsSync(command)) {
        log(`Phel executable not found at ${command}; language server disabled.`);
        return false;
    }

    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
        context.subscriptions.push(outputChannel);
    }

    // Windows cannot start the extension-less Composer proxy; `toInvocation`
    // turns it into `php vendor/bin/phel lsp`.
    const inv = toInvocation(command, args);
    const executable = (): Executable => ({
        command: inv.file,
        args: [...inv.args],
        options: { shell: inv.shell },
        transport: TransportKind.stdio,
    });
    const serverOptions: ServerOptions = { run: executable(), debug: executable() };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'phel' }],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.phel'),
        },
        outputChannel,
        // Phel diagnostics already flow through the server's publishDiagnostics;
        // don't also reveal the output on every error.
        revealOutputChannelOn: 4, // RevealOutputChannelOn.Never
        errorHandler: createErrorHandler(),
    };

    client = new LanguageClient('phel', 'Phel Language Server', serverOptions, clientOptions);

    try {
        await client.start();
        context.subscriptions.push(client);
        log(`Phel language server started (${inv.file} ${inv.args.join(' ')}).`);
        return true;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`Phel language server failed to start: ${message}`);
        try {
            await client.dispose();
        } catch {
            // ignore dispose errors on a server that never came up
        }
        client = undefined;
        return false;
    }
}

export async function stopLanguageClient(): Promise<void> {
    if (!client) {
        return;
    }
    const current = client;
    client = undefined;
    try {
        await current.stop();
    } catch {
        // ignore: the server may already be gone
    }
}

/**
 * Restart the running language client (e.g. after the executable path or args
 * change). No-op when no client is currently running so it can't accidentally
 * start the server when the fallback providers are in use.
 */
export async function restartLanguageClient(context: vscode.ExtensionContext): Promise<void> {
    if (!client) {
        return;
    }
    log('Restarting Phel language server (configuration changed).');
    await stopLanguageClient();
    await startLanguageClient(context);
}

/**
 * Restart the server when its connection closes (it may exit between requests),
 * capped within a sliding window so a genuinely broken binary can't spin
 * forever. Read/write errors are tolerated briefly, then the connection is
 * shut down (which triggers `closed()` and the restart path).
 */
function createErrorHandler(): ErrorHandler {
    const budget = new LspRestartBudget(MAX_SERVER_RESTARTS, RESTART_WINDOW_MS);

    return {
        error(
            _error: Error,
            _message: Message | undefined,
            count: number | undefined
        ): ErrorHandlerResult {
            // Tolerate a few transient transport errors before tearing down.
            return {
                action:
                    count !== undefined && count <= 3 ? ErrorAction.Continue : ErrorAction.Shutdown,
            };
        },
        closed(): CloseHandlerResult {
            if (!budget.shouldRestart()) {
                log(
                    `Phel language server exited ${budget.count} times within ` +
                        `${Math.round(RESTART_WINDOW_MS / 1000)}s; not restarting it again. ` +
                        'Falling back to the bundled language providers.'
                );
                giveUpAndFallBack();
                return {
                    action: CloseAction.DoNotRestart,
                    message:
                        'Phel language server is unavailable; using the bundled language providers.',
                    handled: true,
                };
            }
            log(
                `Phel language server connection closed; restarting (${budget.count}/${MAX_SERVER_RESTARTS}).`
            );
            return { action: CloseAction.Restart, handled: true };
        },
    };
}

/**
 * The server proved unusable. Hand off to the bundled providers exactly once
 * for the rest of the session. The library tears the client down itself when
 * we return `DoNotRestart`, so we only clear our reference and fire the
 * fallback (deferred, so it runs after the library finishes its cleanup).
 */
function giveUpAndFallBack(): void {
    if (gaveUp) {
        return;
    }
    gaveUp = true;
    client = undefined;
    const fallback = onUnrecoverable;
    onUnrecoverable = undefined;
    if (fallback) {
        setImmediate(fallback);
    }
}

function log(message: string): void {
    outputChannel?.appendLine(message);
}
