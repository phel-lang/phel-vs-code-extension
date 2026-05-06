import * as vscode from 'vscode';
import { PHEL_DOCS } from './phelCoreDocs';
import { CORE_FNS, MACROS, SPECIAL_FORMS } from './phelCoreSymbols';
import { lookupSymbol, renderDocMarkdown } from './phelDocsLookup';

const SYMBOL_RE = /[A-Za-z0-9_!?*+<>=/\-.':$&%][^\s(){}[\]"',`]*/;

interface ItemSpec {
    label: string;
    kind: vscode.CompletionItemKind;
    detail: string;
}

function buildSpecs(): ItemSpec[] {
    const specs: ItemSpec[] = [];
    for (const name of SPECIAL_FORMS) {
        specs.push({
            label: name,
            kind: vscode.CompletionItemKind.Keyword,
            detail: 'Phel special form',
        });
    }
    for (const name of MACROS) {
        specs.push({
            label: name,
            kind: vscode.CompletionItemKind.Keyword,
            detail: 'Phel macro',
        });
    }
    for (const name of CORE_FNS) {
        specs.push({
            label: name,
            kind: vscode.CompletionItemKind.Function,
            detail: 'Phel core function',
        });
    }
    return specs;
}

function buildItem(spec: ItemSpec, range?: vscode.Range): vscode.CompletionItem {
    const item = new vscode.CompletionItem(spec.label, spec.kind);
    item.detail = spec.detail;
    const doc = lookupSymbol(spec.label, PHEL_DOCS);
    if (doc) {
        const md = new vscode.MarkdownString(renderDocMarkdown(doc));
        md.isTrusted = false;
        md.supportHtml = false;
        item.documentation = md;
    }
    if (range) {
        item.range = range;
    }
    return item;
}

export class PhelCompletionProvider implements vscode.CompletionItemProvider {
    private readonly specs: ItemSpec[] = buildSpecs();
    private readonly bareItems: vscode.CompletionItem[] = this.specs.map((spec) => buildItem(spec));

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.CompletionItem[]> {
        const range = document.getWordRangeAtPosition(position, SYMBOL_RE);
        if (!range) {
            return this.bareItems;
        }
        return this.specs.map((spec) => buildItem(spec, range));
    }
}
