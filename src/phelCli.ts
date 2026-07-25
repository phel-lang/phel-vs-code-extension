// Shared helper for running a one-shot Phel CLI command and collecting its
// output. Long-running / streaming servers (nrepl, lsp, test --watch) and the
// Test Explorer's per-file run have bespoke spawn logic; this covers the
// common "run it, wait, read stdout/stderr/exit-code" case.

import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import * as vscode from 'vscode';

export interface PhelCliResult {
    code: number;
    stdout: string;
    stderr: string;
}

export interface RunPhelCliOptions {
    /** Called with each stdout chunk as it arrives (e.g. to stream into a channel). */
    onStdout?: (chunk: string) => void;
    /** Kills the process when cancelled. */
    token?: vscode.CancellationToken;
}

/**
 * Spawn `command args` in `cwd`, resolving once it exits. Never rejects:
 * a spawn error resolves with code 1 and the error text in `stderr`.
 */
export function runPhelCli(
    command: string,
    args: readonly string[],
    cwd: string,
    options: RunPhelCliOptions = {}
): Promise<PhelCliResult> {
    return new Promise((resolve) => {
        const proc = spawn(command, [...args], { cwd });
        let stdout = '';
        let stderr = '';
        // Decode across chunk boundaries: `chunk.toString()` on a chunk that
        // ends mid-character yields U+FFFD, and the CLI emits well over one
        // 64 KiB chunk on a large `phel lint` run.
        const outDecoder = new StringDecoder('utf8');
        const errDecoder = new StringDecoder('utf8');
        proc.stdout?.on('data', (d: Buffer) => {
            const text = outDecoder.write(d);
            if (text) {
                stdout += text;
                options.onStdout?.(text);
            }
        });
        proc.stderr?.on('data', (d: Buffer) => {
            stderr += errDecoder.write(d);
        });
        proc.on('close', (code) => {
            stdout += outDecoder.end();
            stderr += errDecoder.end();
            resolve({ code: code ?? 1, stdout, stderr });
        });
        proc.on('error', (err) => resolve({ code: 1, stdout, stderr: err.message }));
        options.token?.onCancellationRequested(() => proc.kill());
    });
}
