// Shared helpers for running a Phel CLI command in an integrated terminal
// (used for interactive / long-running commands: REPL, test runs, watch,
// build, init).

import * as vscode from 'vscode';
import { shellQuote } from './phelCliCommands';

/** Open (or reuse a freshly created) terminal and run `command args` in `cwd`. */
export function runInTerminal(
    name: string,
    command: string,
    args: readonly string[],
    cwd: string
): void {
    const terminal = vscode.window.createTerminal({ name, cwd });
    terminal.show(true);
    terminal.sendText([command, ...args].map(shellQuote).join(' '));
}
