import * as vscode from 'vscode';
import { PHEL_DOCS } from './phelCoreDocs';
import { CORE_FNS, MACROS, SPECIAL_FORMS } from './phelCoreSymbols';
import { lookupSymbol, renderDocMarkdown } from './phelDocsLookup';
import { combineDocs } from './phelWorkspaceIndex';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';

const SYMBOL_RE = /[A-Za-z0-9_!?*+<>=/\-.':$&%][^\s(){}[\]"',`]*/;

interface ItemSpec {
    label: string;
    kind: vscode.CompletionItemKind;
    detail: string;
}

function buildBaseSpecs(): ItemSpec[] {
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

function workspaceSpecs(indexer?: PhelWorkspaceIndexer): ItemSpec[] {
    if (!indexer) {
        return [];
    }
    const seen = new Set<string>();
    const specs: ItemSpec[] = [];
    for (const doc of indexer.index.allDocs()) {
        if (doc.private) {
            continue;
        }
        if (seen.has(doc.name)) {
            continue;
        }
        seen.add(doc.name);
        specs.push({
            label: doc.name,
            kind:
                doc.kind === 'macro'
                    ? vscode.CompletionItemKind.Keyword
                    : vscode.CompletionItemKind.Function,
            detail: `${doc.ns} (workspace)`,
        });
    }
    return specs;
}

function buildItem(
    spec: ItemSpec,
    range: vscode.Range | undefined,
    docs: readonly import('./phelDocs').PhelDoc[]
): vscode.CompletionItem {
    const item = new vscode.CompletionItem(spec.label, spec.kind);
    item.detail = spec.detail;
    const doc = lookupSymbol(spec.label, docs);
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
    private readonly baseSpecs: ItemSpec[] = buildBaseSpecs();

    constructor(private readonly indexer?: PhelWorkspaceIndexer) {}

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.CompletionItem[]> {
        const range = document.getWordRangeAtPosition(position, SYMBOL_RE);
        const merged = this.indexer
            ? combineDocs(this.indexer.index.allDocs(), PHEL_DOCS)
            : [...PHEL_DOCS];
        const specs = [...this.baseSpecs, ...workspaceSpecs(this.indexer)];
        return specs.map((spec) => buildItem(spec, range, merged));
    }
}
