import * as vscode from 'vscode';
import {
    lookupSymbol,
    renderDocMarkdown,
    renderLocalMarkdown,
    renderSuperglobalMarkdown,
    renderSupersededMarkdown,
} from './phelDocsLookup';
import { PHP_SUPERGLOBALS } from './phelCoreSymbols';
import { MIGRATIONS } from './phelMigration';
import { aliasMapFromSource } from './phelNsAnalyzer';
import { resolveLocalAt } from './phelScope';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';
import { PHEL_SYMBOL_RE } from './phelSymbolToken';
import { mergedDocs, plainMarkdown } from './phelProviderSupport';

/** The forms deprecated as source in 0.50, keyed by name. */
const SUPERSEDED = new Map(
    MIGRATIONS.filter((e) => e.status === 'deprecated').map((e) => [e.name, e.detail])
);

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

        // Neither a superglobal nor a special form is declared in any `.phel`
        // file, so both are checked before the corpus rather than through it.
        const superglobal = PHP_SUPERGLOBALS.get(word);
        if (superglobal) {
            const md = plainMarkdown(renderSuperglobalMarkdown(word, superglobal));
            return new vscode.Hover(md, range);
        }
        const superseded = SUPERSEDED.get(word);
        if (superseded) {
            const md = plainMarkdown(renderSupersededMarkdown(word, superseded));
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
