// Shared workspace-folder resolution. Several features need "the folder this
// document belongs to, or the first workspace folder as a fallback"; this is
// the single source of that logic.

import * as vscode from 'vscode';

/** The workspace folder owning `doc`, else the first workspace folder. */
export function folderForDocument(doc?: vscode.TextDocument): vscode.WorkspaceFolder | undefined {
    if (doc && doc.uri.scheme === 'file') {
        const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
        if (folder) {
            return folder;
        }
    }
    return vscode.workspace.workspaceFolders?.[0];
}

/** The folder for the active editor's document, else the first workspace folder. */
export function activeWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
    return folderForDocument(vscode.window.activeTextEditor?.document);
}
