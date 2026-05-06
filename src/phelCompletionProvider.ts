import * as vscode from 'vscode';
import { CORE_FNS, MACROS, SPECIAL_FORMS } from './phelCoreSymbols';

const SYMBOL_RE = /[A-Za-z0-9_!?*+<>=/\-.':$&%][^\s(){}[\]"',`]*/;

function buildItems(): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];

    for (const name of SPECIAL_FORMS) {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
        item.detail = 'Phel special form';
        items.push(item);
    }

    for (const name of MACROS) {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
        item.detail = 'Phel macro';
        items.push(item);
    }

    for (const name of CORE_FNS) {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
        item.detail = 'Phel core function';
        items.push(item);
    }

    return items;
}

export class PhelCompletionProvider implements vscode.CompletionItemProvider {
    private readonly items: vscode.CompletionItem[] = buildItems();

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.CompletionItem[]> {
        const range = document.getWordRangeAtPosition(position, SYMBOL_RE);
        if (!range) {
            return this.items;
        }
        return this.items.map((item) => {
            const cloned = new vscode.CompletionItem(item.label, item.kind);
            cloned.detail = item.detail;
            cloned.range = range;
            return cloned;
        });
    }
}
