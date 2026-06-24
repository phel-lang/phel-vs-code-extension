// Shared helper for running a Phel CLI command in a dedicated integrated
// terminal (used for one-shot / long-running commands: test runs, watch,
// build, init).

import * as vscode from 'vscode';

/**
 * Open a terminal that runs `command args` directly as its shell process and
 * exits when the command does.
 *
 * Passing the command via `shellPath`/`shellArgs` makes VS Code spawn the
 * process itself (argv array, no intermediate shell), so arguments with spaces
 * or shell metacharacters are passed verbatim and the behaviour is identical on
 * POSIX and Windows. (This is the same mechanism the REPL terminal uses.)
 */
export function runInTerminal(
    name: string,
    command: string,
    args: readonly string[],
    cwd: string
): void {
    const terminal = vscode.window.createTerminal({
        name,
        cwd,
        shellPath: command,
        shellArgs: [...args],
    });
    terminal.show(true);
}
