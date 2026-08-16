// Shared workspace-folder resolution. Several features need "the folder this
// document belongs to, or the first workspace folder as a fallback"; this is
// the single source of that logic.

import * as vscode from 'vscode';

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
