// Shared workspace-folder resolution. Several features need "the folder this
// document belongs to, or the first workspace folder as a fallback"; this is
// the single source of that logic.
//
// It also owns the editor's side of `phelPaths`: every path the CLI or the
// daemon reports comes back with its symlinks resolved, and turning one into a
// URI without putting the folder's own spelling back addresses a file the
// editor considers a different one.

import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { canonicalToWorkspace } from './phelPaths';

/** The workspace folder owning `uri`, if any. Untitled / non-file uris have none. */
export function folderForUri(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.getWorkspaceFolder(uri);
}

/** The workspace folder owning `doc`, else the first workspace folder. */
export function folderForDocument(doc?: vscode.TextDocument): vscode.WorkspaceFolder | undefined {
    const owner = doc && doc.uri.scheme === 'file' ? folderForUri(doc.uri) : undefined;
    return owner ?? vscode.workspace.workspaceFolders?.[0];
}

/** The folder for the active editor's document, else the first workspace folder. */
export function activeWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
    return folderForDocument(vscode.window.activeTextEditor?.document);
}

/**
 * The folder a folder-scoped command (build, lint, doctor, …) should run in.
 * Unlike `activeWorkspaceFolder`, this never silently guesses in a multi-root
 * workspace: the active file's folder, the only folder when there is one,
 * otherwise the user picks.
 *
 * Returns undefined both when no folder is open — after warning with
 * `noFolderMessage` — and when the pick is cancelled, which is silent. Callers
 * return without a message in either case.
 */
export async function pickWorkspaceFolder(
    noFolderMessage = 'Open a Phel project folder first.'
): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
        void vscode.window.showWarningMessage(noFolderMessage);
        return undefined;
    }
    const active = vscode.window.activeTextEditor?.document;
    if (active && active.uri.scheme === 'file') {
        const folder = folderForUri(active.uri);
        if (folder) {
            return folder;
        }
    }
    if (folders.length === 1) {
        return folders[0];
    }
    return vscode.window.showWorkspaceFolderPick();
}

/**
 * Resolved (symlink-free) folder paths, keyed by folder uri. `realpathSync`
 * hits the filesystem and this sits behind go-to-definition, so it is answered
 * once per folder rather than once per location.
 */
const realPaths = new Map<string, string>();

/** `folder` with every symlink resolved, which is how the CLI spells it. */
export function workspaceRealPath(folder: vscode.WorkspaceFolder): string {
    const key = folder.uri.toString();
    const cached = realPaths.get(key);
    if (cached !== undefined) {
        return cached;
    }
    let real: string;
    try {
        real = fs.realpathSync(folder.uri.fsPath);
    } catch {
        // A folder that vanished, or one on a filesystem that cannot say; the
        // spelling we have is then the only one there is.
        real = folder.uri.fsPath;
    }
    realPaths.set(key, real);
    return real;
}

/**
 * Forgets the resolved path of a folder once it leaves the workspace, so a
 * folder re-added at the same uri is resolved again. Registered from
 * `activate`; the cache is module-level because everything here is a free
 * function providers reach for directly.
 */
export function watchWorkspaceFolderPaths(): vscode.Disposable {
    return vscode.workspace.onDidChangeWorkspaceFolders((e) => {
        for (const removed of e.removed) {
            realPaths.delete(removed.uri.toString());
        }
    });
}

/** A path the CLI reported, spelled as the editor spells it. */
export function pathFromCli(fsPath: string, folder: vscode.WorkspaceFolder | undefined): string {
    return folder
        ? canonicalToWorkspace(fsPath, {
              fsPath: folder.uri.fsPath,
              realPath: workspaceRealPath(folder),
          })
        : fsPath;
}

/** `pathFromCli` as a URI, which is what the callers of both actually want. */
export function uriFromCli(fsPath: string, folder: vscode.WorkspaceFolder | undefined): vscode.Uri {
    return vscode.Uri.file(pathFromCli(fsPath, folder));
}
