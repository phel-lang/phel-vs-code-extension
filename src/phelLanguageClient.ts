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
    LanguageClient,
    type LanguageClientOptions,
    type ServerOptions,
    State,
    TransportKind,
} from 'vscode-languageclient/node';
import { resolvePhelExecutable } from './phelExecutable';

const OUTPUT_CHANNEL_NAME = 'Phel Language Server';

let client: LanguageClient | undefined;
let outputChannel: vscode.OutputChannel | undefined;

export function isLanguageServerEnabled(): boolean {
    return vscode.workspace.getConfiguration('phel').get<boolean>('lsp.enabled', true);
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
 */
export async function startLanguageClient(context: vscode.ExtensionContext): Promise<boolean> {
    if (client) {
        return isLanguageServerRunning();
    }

    const folder = vscode.workspace.workspaceFolders?.[0];
    const { command, args } = resolveServerCommand(folder);

    // A relative path that doesn't resolve to a real file means Phel isn't
    // installed where we expect; bail quietly so the TS providers take over.
    if (path.isAbsolute(command) && !fs.existsSync(command)) {
        log(`Phel executable not found at ${command}; language server disabled.`);
        return false;
    }

    outputChannel ??= vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);

    const serverOptions: ServerOptions = {
        run: { command, args, transport: TransportKind.stdio },
        debug: { command, args, transport: TransportKind.stdio },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'phel' }],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.phel'),
        },
        outputChannel,
        // Phel diagnostics already flow through the server's publishDiagnostics;
        // don't also reveal the output on every error.
        revealOutputChannelOn: 4, // RevealOutputChannelOn.Never
    };

    client = new LanguageClient('phel', 'Phel Language Server', serverOptions, clientOptions);

    try {
        await client.start();
        context.subscriptions.push(client);
        log(`Phel language server started (${command} ${args.join(' ')}).`);
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

function log(message: string): void {
    outputChannel?.appendLine(message);
}
