import * as vscode from 'vscode';
import { lookupSymbol } from './phelDocsLookup';
import { aliasMapFromSource } from './phelNsAnalyzer';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';
import { resolveLocalAt } from './phelScope';
import { PHEL_SYMBOL_RE } from './phelSymbolToken';
import { mergedDocs } from './phelProviderSupport';

export class PhelDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private readonly indexer: PhelWorkspaceIndexer) {}

    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        const range = document.getWordRangeAtPosition(position, PHEL_SYMBOL_RE);
        if (!range) {
            return null;
        }
        const word = document.getText(range);

        // A locally-bound symbol (fn/let/loop param, catch var, …) resolves to
        // its binding site in this document, never to a same-named global.
        const src = document.getText();
        const local = resolveLocalAt(src, document.offsetAt(range.start));
        if (local) {
            return new vscode.Location(
                document.uri,
                new vscode.Range(
                    document.positionAt(local.declStart),
                    document.positionAt(local.declEnd)
                )
            );
        }

        const merged = mergedDocs(this.indexer);
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
