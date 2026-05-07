// Pure path-resolution helper. Kept free of `vscode` imports so unit tests
// can exercise it directly. The vscode-aware glue lives in
// `phelExecutable.ts`.

import * as path from 'node:path';

export const DEFAULT_PHEL_EXECUTABLE = 'vendor/bin/phel';

/**
 * Picks the explicit override, then the fallback, then the built-in
 * default. Relative paths are anchored to `cwd`.
 */
export function resolveExecutablePath(
    explicit: string | undefined,
    fallback: string | undefined,
    cwd: string
): string {
    const cmd = explicit ?? fallback ?? DEFAULT_PHEL_EXECUTABLE;
    return path.isAbsolute(cmd) ? cmd : path.join(cwd, cmd);
}
