import * as vscode from 'vscode';
import { PHEL_DOCS } from './phelCoreDocs';
import { lookupSymbol, renderDocMarkdown } from './phelDocsLookup';

const SYMBOL_RE = /[A-Za-z0-9_!?*+<>=/\-.':$&%][^\s(){}[\]"',`]*/;

export class PhelHoverProvider implements vscode.HoverProvider {
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.Hover> {
        const range = document.getWordRangeAtPosition(position, SYMBOL_RE);
        if (!range) {
            return null;
        }
        const word = document.getText(range);
        const doc = lookupSymbol(word, PHEL_DOCS);
        if (!doc) {
            return null;
        }
        const md = new vscode.MarkdownString(renderDocMarkdown(doc));
        md.isTrusted = false;
        md.supportHtml = false;
        return new vscode.Hover(md, range);
    }
}
