// Turns a resolved Phel executable path into something the current platform
// can actually start, and holds the one environment tweak a run may need.
// Kept free of `vscode` imports so unit tests can drive every Windows branch
// from any OS.
//
// Composer installs two proxies side by side: `vendor/bin/phel`, a PHP script,
// and `vendor/bin/phel.bat`, whose entire body is `php "%~dp0/phel" %*`.
// `resolveExecutablePath` hands us the extension-less one, which Windows cannot
// execute at all, and Node (>= 18.20 / >= 20.12) refuses to spawn a `.bat` or
// `.cmd` unless `shell: true` is set. So on Windows we do what the `.bat` does
// — run the PHP proxy through `php` — which keeps the argv array intact and
// avoids `cmd.exe` quoting entirely. The shelled-out batch file is only the
// fallback for installs that have no PHP proxy (a `phel` on `PATH`, or an
// executable the user pointed at themselves).

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The environment a `--coverage` run needs on top of the host's own, or
 * `undefined` when it already has it.
 *
 * Xdebug only records executed lines when `coverage` is one of its *active*
 * modes, and the mode a developer keeps in `php.ini` is `develop,debug`. On
 * such a machine `phel test --coverage=clover` writes no report and says
 * "--coverage requires the pcov or xdebug extension; xdebug is loaded but
 * 'coverage' is not an active mode" — so a coverage run asks for the mode it
 * needs. An `XDEBUG_MODE` that already lists `coverage` is left alone, since
 * narrowing it would drop the other modes the user asked for.
 */
export function coverageEnv(current: string | undefined): Record<string, string> | undefined {
    const modes = (current ?? '').split(',').map((mode) => mode.trim());
    return modes.includes('coverage') ? undefined : { XDEBUG_MODE: 'coverage' };
}

export interface PhelInvocation {
    /** Executable to spawn. */
    file: string;
    /** Arguments as an argv array (never a joined command line). */
    args: string[];
    /** Only set when the command has to go through `cmd.exe`. */
    shell?: boolean;
}

export interface ToInvocationOptions {
    /** Defaults to `process.platform`; injected by the tests. */
    platform?: NodeJS.Platform;
    /** Defaults to `fs.existsSync`; injected by the tests. */
    exists?: (p: string) => boolean;
}

/**
 * Maps `command args` onto a spawnable invocation. Outside Windows, and for a
 * Windows `.exe` (or anything else the OS knows how to start), that is the
 * command as given.
 */
export function toInvocation(
    command: string,
    args: readonly string[],
    options: ToInvocationOptions = {}
): PhelInvocation {
    const platform = options.platform ?? process.platform;
    const exists = options.exists ?? fs.existsSync;
    if (platform !== 'win32') {
        return { file: command, args: [...args] };
    }
    // `path.win32` regardless of where the test runs; it accepts both separators.
    const ext = path.win32.extname(command).toLowerCase();
    if (ext !== '' && ext !== '.bat' && ext !== '.cmd') {
        return { file: command, args: [...args] };
    }
    const proxy = ext === '' ? command : command.slice(0, -ext.length);
    if (exists(proxy)) {
        return { file: 'php', args: [proxy, ...args] };
    }
    const batch = ext === '' && exists(`${command}.bat`) ? `${command}.bat` : command;
    return { file: batch, args: [...args], shell: true };
}
