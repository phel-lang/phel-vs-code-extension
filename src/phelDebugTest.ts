// Running a `deftest` under the debugger in one step.
//
// A Phel debug session is a *listener*: `launch` opens an Xdebug port and waits
// for a PHP process to connect back. Doing that by hand means starting the
// session, then remembering to run the test with the three environment
// variables that make PHP dial in. This does both, in that order — the listener
// has to be up before the run starts, or the process finds nothing to connect
// to and runs straight through.
//
// The port is ephemeral by default: the run is told which one to use through
// `XDEBUG_CONFIG`, so nothing has to agree on 9003, and a listener already up
// on the default port cannot collide with this one.

import * as net from 'node:net';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { testArgs } from './phelCliCommands';
import { resolvePhelExecutable } from './phelExecutable';
import { runInTerminal } from './phelTerminal';

const TERMINAL_NAME = 'Phel Debug Test';

export interface DebugTestRun {
    /** The terminal the CLI runs in; it exits when the run finishes. */
    terminal: vscode.Terminal;
    /** The port the debug session is listening on. */
    port: number;
    /** The session started for this run, when the editor named it. */
    session?: vscode.DebugSession;
}

/**
 * Start a debug session for `fileUri` and run its tests against it.
 *
 * Answers `undefined` when the editor refused to start the session, in which
 * case nothing is run: a test process dialling a port nobody listens on is
 * worse than no run at all, because it looks like it worked.
 */
export async function startDebugTestRun(
    folder: vscode.WorkspaceFolder | undefined,
    fileUri: vscode.Uri,
    testName?: string
): Promise<DebugTestRun | undefined> {
    const command = resolvePhelExecutable('test.command', folder);
    const cwd = folder?.uri.fsPath ?? path.dirname(fileUri.fsPath);
    const relativeFile = path.relative(cwd, fileUri.fsPath) || fileUri.fsPath;
    const port = await debugPort(folder);

    // `startDebugging` answers whether it worked, not which session it made.
    // Listening around the call is the only way to get hold of it — the caller
    // needs it to stop the listener once the run is over.
    let session: vscode.DebugSession | undefined;
    const listener = vscode.debug.onDidStartDebugSession((candidate) => {
        if (candidate.type === 'phel' && candidate.configuration.phpDebugPort === port) {
            session = candidate;
        }
    });
    let started: boolean;
    try {
        started = await vscode.debug.startDebugging(folder, {
            type: 'phel',
            request: 'launch',
            name: 'Debug Phel test',
            phpDebugPort: port,
        });
    } finally {
        listener.dispose();
    }
    if (!started) {
        vscode.window.showErrorMessage(
            'Could not start the Phel debug session (is `phel.debug.enabled` on?).'
        );
        return undefined;
    }

    const terminal = runInTerminal(TERMINAL_NAME, command, testArgs(relativeFile, testName), cwd, {
        // `XDEBUG_MODE` turns the debugger on for this process only, so nothing
        // in php.ini has to change; `XDEBUG_SESSION` is the trigger a CLI run
        // needs when Xdebug is configured to start on request; `client_port` is
        // where to dial.
        XDEBUG_MODE: 'debug',
        XDEBUG_SESSION: '1',
        XDEBUG_CONFIG: `client_port=${port}`,
    });

    return { terminal, port, session };
}

/** The `Phel: Debug Test` command: the active file, or the one a lens passed. */
export async function debugPhelTest(uri?: vscode.Uri, testName?: string): Promise<void> {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) {
        vscode.window.showWarningMessage('Open a .phel test file first.');
        return;
    }
    await startDebugTestRun(vscode.workspace.getWorkspaceFolder(target), target, testName);
}

/** Resolve once the terminal's process has exited, or the run was cancelled. */
export function waitForTerminalExit(
    terminal: vscode.Terminal,
    token?: vscode.CancellationToken
): Promise<void> {
    if (terminal.exitStatus) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const subscriptions: vscode.Disposable[] = [];
        const done = (): void => {
            subscriptions.forEach((s) => s.dispose());
            resolve();
        };
        subscriptions.push(
            vscode.window.onDidCloseTerminal((closed) => {
                if (closed === terminal) {
                    done();
                }
            })
        );
        if (token) {
            subscriptions.push(
                token.onCancellationRequested(() => {
                    terminal.dispose();
                    done();
                })
            );
        }
    });
}

/**
 * The port to listen on: whatever a `phel` launch configuration in this folder
 * pins, otherwise one the OS hands out. Pinning it matters for a container or a
 * fixed `xdebug.client_port`, where the run cannot be told where to dial.
 */
async function debugPort(folder: vscode.WorkspaceFolder | undefined): Promise<number> {
    const configured = vscode.workspace
        .getConfiguration('launch', folder?.uri)
        .get<Array<{ type?: string; phpDebugPort?: number }>>('configurations', [])
        .find((config) => config.type === 'phel' && typeof config.phpDebugPort === 'number');

    return configured?.phpDebugPort ?? (await freePort());
}

/** A port nothing is listening on, asked for and released by the OS. */
function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            if (address === null || typeof address === 'string') {
                probe.close(() => reject(new Error('could not find a free port to listen on')));
                return;
            }
            probe.close(() => resolve(address.port));
        });
    });
}
