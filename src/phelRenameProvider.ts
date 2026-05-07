// Workspace-wide rename for Phel symbols. Reuses the find-references
// scanner so every standalone occurrence (excluding strings and comments)
// is rewritten consistently.
//
// `prepareRename` rejects names that aren't valid Phel symbol tokens to
// avoid producing broken source.

import * as vscode from 'vscode';
import { findReferenceLocations } from './phelReferenceProvider';
import { isValidSymbolName } from './phelReferences';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';

const SYMBOL_RE = /[A-Za-z0-9_!?*+<>=/\-.':$&%][^\s(){}[\]"',`]*/;

export class PhelRenameProvider implements vscode.RenameProvider {
    constructor(private readonly indexer: PhelWorkspaceIndexer) {}

    prepareRename(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.Range | { range: vscode.Range; placeholder: string }> {
        const range = document.getWordRangeAtPosition(position, SYMBOL_RE);
        if (!range) {
            throw new Error('No symbol at cursor.');
        }
        return { range, placeholder: document.getText(range) };
    }

    async provideRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string
    ): Promise<vscode.WorkspaceEdit | undefined> {
        if (!isValidSymbolName(newName)) {
            throw new Error(`'${newName}' is not a valid Phel symbol name.`);
        }
        const range = document.getWordRangeAtPosition(position, SYMBOL_RE);
        if (!range) {
            return undefined;
        }
        const oldName = document.getText(range);
        if (oldName === newName) {
            return undefined;
        }

        const locations = await findReferenceLocations(oldName, document, this.indexer);
        const edit = new vscode.WorkspaceEdit();
        for (const loc of locations) {
            edit.replace(loc.uri, loc.range, newName);
        }
        return edit;
    }
}
