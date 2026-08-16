// Workspace-wide rename for Phel symbols. Reuses the find-references search so
// every reference site (excluding strings and comments) is rewritten
// consistently — including the ones written `alias/name`, where only the name
// half is replaced and the alias is left alone.
//
// `prepareRename` rejects names that aren't valid Phel symbol tokens to
// avoid producing broken source.

import * as vscode from 'vscode';
import { findMergedReferences } from './phelReferenceProvider';
import { isValidSymbolName } from './phelReferences';
import { resolveLocalAt, localOccurrences } from './phelScope';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';
import { PHEL_SYMBOL_RE } from './phelSymbolToken';

export class PhelRenameProvider implements vscode.RenameProvider {
    constructor(private readonly indexer: PhelWorkspaceIndexer) {}

    prepareRename(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.Range | { range: vscode.Range; placeholder: string }> {
        const range = document.getWordRangeAtPosition(position, PHEL_SYMBOL_RE);
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
        // The box is pre-filled with the whole token, so a user renaming
        // `s/shout` in place sends back `s/yell`. Either spelling means the same
        // rename: the alias belongs to the file that wrote it, not to the name.
        const wanted = bareName(newName);
        if (!isValidSymbolName(wanted)) {
            throw new Error(`'${newName}' is not a valid Phel symbol name.`);
        }
        const range = document.getWordRangeAtPosition(position, PHEL_SYMBOL_RE);
        if (!range) {
            return undefined;
        }
        const oldName = document.getText(range);
        if (bareName(oldName) === wanted) {
            return undefined;
        }

        const edit = new vscode.WorkspaceEdit();

        // A local binding renames only within its lexical scope in this file,
        // leaving same-named globals and other-scope locals untouched.
        const src = document.getText();
        const local = resolveLocalAt(src, document.offsetAt(range.start));
        if (local) {
            for (const occ of localOccurrences(src, local)) {
                edit.replace(
                    document.uri,
                    new vscode.Range(document.positionAt(occ.start), document.positionAt(occ.end)),
                    wanted
                );
            }
            return edit;
        }

        for (const reference of await findMergedReferences(oldName, document, this.indexer)) {
            edit.replace(reference.location.uri, reference.nameRange, wanted);
        }
        return edit;
    }
}

/** `s/shout` names `shout`; the prefix is the file's alias, not the symbol. */
function bareName(token: string): string {
    return token.slice(token.lastIndexOf('/') + 1);
}
