import * as vscode from 'vscode';
import { PHEL_DOCS } from './phelCoreDocs';
import { lookupSymbol, renderDocMarkdown, renderLocalMarkdown } from './phelDocsLookup';
import { aliasMapFromSource } from './phelNsAnalyzer';
import { resolveLocalAt } from './phelScope';
import { combineDocs } from './phelWorkspaceIndex';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';

const SYMBOL_RE = /[A-Za-z0-9_!?*+<>=/\-.':$&%][^\s(){}[\]"',`]*/;

export class PhelHoverProvider implements vscode.HoverProvider {
    constructor(private readonly indexer?: PhelWorkspaceIndexer) {}

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.Hover> {
        const range = document.getWordRangeAtPosition(position, SYMBOL_RE);
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
            const md = new vscode.MarkdownString(renderLocalMarkdown(local, declLine));
            md.isTrusted = false;
            md.supportHtml = false;
            return new vscode.Hover(md, range);
        }

        const merged = this.indexer
            ? combineDocs(this.indexer.index.allDocs(), PHEL_DOCS)
            : [...PHEL_DOCS];
        const aliases = aliasMapFromSource(src);
        const doc = lookupSymbol(word, merged, aliases);
        if (!doc) {
            return null;
        }
        const md = new vscode.MarkdownString(renderDocMarkdown(doc));
        md.isTrusted = false;
        md.supportHtml = false;
        return new vscode.Hover(md, range);
    }
}
