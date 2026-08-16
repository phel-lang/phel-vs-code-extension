// Spelling a path the CLI printed the way the editor spells it.
//
// Phel resolves every path it reports through PHP's `realpath`, so a project
// opened as `/var/folders/…/demo` (macOS `/var` is a symlink to `/private/var`,
// and a symlinked `~/Code` is just as common) comes back as
// `/private/var/folders/…/demo`. VS Code keeps the spelling the workspace was
// opened with: a `Uri.file` built from the CLI's answer is a *different* file to
// the editor, so diagnostics land on a document nothing shows and go-to-
// definition opens a second copy of an already-open file.
//
// Mapping the folder prefix back is enough, since a CLI path only ever differs
// from the editor's inside the folder it ran in.
//
// Kept free of `vscode` imports so unit tests can drive the Windows branch from
// any OS; the vscode-side wrappers live in `phelWorkspace`.

import * as path from 'node:path';

/** The two spellings of one workspace folder. */
export interface PhelFolderPaths {
    /** As the workspace was opened, i.e. what `folder.uri.fsPath` says. */
    fsPath: string;
    /** The same folder with every symlink resolved, i.e. what the CLI prints. */
    realPath: string;
}

export interface PhelPathOptions {
    /** Defaults to `process.platform`; injected by the tests. */
    platform?: NodeJS.Platform;
}

/**
 * `fsPath` as the editor spells it: a path inside the folder's resolved
 * location gets the folder's own spelling back, anything else is returned
 * untouched (a path outside the folder, or a folder that is not symlinked).
 */
export function canonicalToWorkspace(
    fsPath: string,
    folder: PhelFolderPaths,
    options: PhelPathOptions = {}
): string {
    const win32 = (options.platform ?? process.platform) === 'win32';
    const real = trimTrailingSep(folder.realPath, win32);
    const spelled = trimTrailingSep(folder.fsPath, win32);
    if (!fsPath || !real || !spelled || equals(real, spelled, win32)) {
        return fsPath;
    }
    if (!equals(fsPath.slice(0, real.length), real, win32)) {
        return fsPath;
    }
    const rest = fsPath.slice(real.length);
    // Only at a path boundary: `/private/var2/x` does not live in `/private/var`.
    if (rest && !isSep(rest[0], win32)) {
        return fsPath;
    }
    return spelled + rest;
}

/**
 * Windows spells the same path in more than one way — either drive-letter case,
 * either separator — so comparing there normalises both. Everywhere else a path
 * is the bytes it is made of.
 */
function equals(a: string, b: string, win32: boolean): boolean {
    return win32
        ? a.toLowerCase().replace(/\\/g, '/') === b.toLowerCase().replace(/\\/g, '/')
        : a === b;
}

function isSep(char: string, win32: boolean): boolean {
    return char === '/' || (win32 && char === '\\');
}

/** Drop a trailing separator, but never turn a root (`/`, `C:\`) into nothing. */
function trimTrailingSep(folder: string, win32: boolean): string {
    // `path.win32` regardless of where this runs; it accepts both separators.
    const root = win32 ? path.win32.parse(folder).root : path.posix.parse(folder).root;
    let end = folder.length;
    while (end > root.length && isSep(folder[end - 1], win32)) {
        end--;
    }
    return folder.slice(0, end);
}
