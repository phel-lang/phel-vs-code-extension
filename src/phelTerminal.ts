// Shared helper for running a Phel CLI command in a dedicated integrated
// terminal (used for one-shot / long-running commands: test runs, watch,
// build, init).

import * as vscode from 'vscode';
import { toInvocation } from './phelInvocation';

/**
 * Open a terminal that runs `command args` directly as its shell process and
 * exits when the command does.
 *
 * Passing the command via `shellPath`/`shellArgs` makes VS Code spawn the
 * process itself (argv array, no intermediate shell), so arguments with spaces
 * or shell metacharacters are passed verbatim. (This is the same mechanism the
 * REPL terminal uses.) `toInvocation` is what makes that spawnable on Windows:
 * there the terminal runs `php vendor/bin/phel …`, as the `.bat` proxy would.
 *
 * `env` is merged over the host's environment by VS Code, and is how a run gets
 * what argv cannot carry — `XDEBUG_MODE` and friends, for a debug run.
 */
export function runInTerminal(
    name: string,
    command: string,
    args: readonly string[],
    cwd: string,
    env?: Record<string, string>
): vscode.Terminal {
    const inv = toInvocation(command, args);
    const terminal = vscode.window.createTerminal({
        name,
        cwd,
        shellPath: inv.file,
        shellArgs: inv.args,
        env,
    });
    terminal.show(true);
    return terminal;
}
