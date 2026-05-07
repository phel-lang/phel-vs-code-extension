import * as vscode from 'vscode';
import { lookupSymbol } from './phelDocsLookup';
import { aliasMapFromSource } from './phelNsAnalyzer';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';
import { combineDocs } from './phelWorkspaceIndex';
import { PHEL_DOCS } from './phelCoreDocs';

const SYMBOL_RE = /[A-Za-z0-9_!?*+<>=/\-.':$&%][^\s(){}[\]"',`]*/;

export class PhelDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private readonly indexer: PhelWorkspaceIndexer) {}

    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        const range = document.getWordRangeAtPosition(position, SYMBOL_RE);
        if (!range) {
            return null;
        }
        const word = document.getText(range);

        const merged = combineDocs(this.indexer.index.allDocs(), PHEL_DOCS);
        const aliases = aliasMapFromSource(document.getText());
        const doc = lookupSymbol(word, merged, aliases);
        if (!doc) {
            return null;
        }

        // Workspace docs carry sourceFile + line / column.
        if ('sourceFile' in doc && typeof doc.line === 'number') {
            const target = vscode.Uri.file(doc.sourceFile as string);
            const line = doc.line ?? 0;
            const column = doc.column ?? 0;
            return new vscode.Location(target, new vscode.Position(line, column));
        }

        return null;
    }
}
