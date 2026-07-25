import * as vscode from 'vscode';
import { lookupSymbol, renderDocMarkdown, renderLocalMarkdown } from './phelDocsLookup';
import { aliasMapFromSource } from './phelNsAnalyzer';
import { resolveLocalAt } from './phelScope';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';
import { PHEL_SYMBOL_RE } from './phelSymbolToken';
import { mergedDocs, plainMarkdown } from './phelProviderSupport';

export class PhelHoverProvider implements vscode.HoverProvider {
    constructor(private readonly indexer?: PhelWorkspaceIndexer) {}

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.Hover> {
        const range = document.getWordRangeAtPosition(position, PHEL_SYMBOL_RE);
        if (!range) {
            return null;
        }
        const word = document.getText(range);
        const src = document.getText();

        // A local shadows any global of the same name, and most short parameter
        // names (`name`, `map`, `key`, `count`, …) are also `phel.core`
        // functions — showing those docs here would be plainly wrong.
        const local = resolveLocalAt(src, document.offsetAt(range.start));
        if (local) {
            const declLine = document.lineAt(document.positionAt(local.declStart).line).text;
            const md = plainMarkdown(renderLocalMarkdown(local, declLine));
            return new vscode.Hover(md, range);
        }

        const merged = mergedDocs(this.indexer);
        const aliases = aliasMapFromSource(src);
        const doc = lookupSymbol(word, merged, aliases);
        if (!doc) {
            return null;
        }
        const md = plainMarkdown(renderDocMarkdown(doc));
        return new vscode.Hover(md, range);
    }
}
