import * as vscode from 'vscode';
import { PHEL_DOCS } from './phelCoreDocs';
import { CORE_FNS, MACROS, SPECIAL_FORMS } from './phelCoreSymbols';
import { buildCallSnippet, isCalleePosition } from './phelCallSnippet';
import { lookupSymbol, renderDocMarkdown } from './phelDocsLookup';
import { buildRequireEdit, parseNsForm, type NsForm } from './phelNsAnalyzer';
import { combineDocs } from './phelWorkspaceIndex';
import { localsInScopeAt } from './phelScope';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';

const SYMBOL_RE = /[A-Za-z0-9_!?*+<>=/\-.':$&%][^\s(){}[\]"',`]*/;

interface ItemSpec {
    label: string;
    kind: vscode.CompletionItemKind;
    detail: string;
    /** Namespace this symbol lives in. Used for auto-import. */
    ns?: string;
    /** Whether this symbol is a workspace doc (vs a core fn / built-in). */
    workspace?: boolean;
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

/** Private defs from the current file — offerable unqualified inside their own file. */
function privateFileSpecs(
    indexer: PhelWorkspaceIndexer | undefined,
    document: vscode.TextDocument
): ItemSpec[] {
    if (!indexer) {
        return [];
    }
    const specs: ItemSpec[] = [];
    for (const doc of indexer.index.docsForFile(document.uri.fsPath)) {
        if (!doc.private) {
            continue; // publics are already covered by workspaceSpecs
        }
        specs.push({
            label: doc.name,
            kind:
                doc.kind === 'macro'
                    ? vscode.CompletionItemKind.Keyword
                    : vscode.CompletionItemKind.Function,
            detail: `${doc.ns} (private)`,
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
            ns: doc.ns,
            workspace: true,
        });
    }
    return specs;
}

function buildItem(
    spec: ItemSpec,
    range: vscode.Range | undefined,
    docs: readonly import('./phelDocs').PhelDoc[],
    document: vscode.TextDocument,
    nsForm: NsForm | null,
    callee: boolean
): vscode.CompletionItem {
    const item = new vscode.CompletionItem(spec.label, spec.kind);
    item.detail = spec.detail;
    const doc = lookupSymbol(spec.label, docs);
    if (doc) {
        const md = new vscode.MarkdownString(renderDocMarkdown(doc));
        md.isTrusted = false;
        md.supportHtml = false;
        item.documentation = md;
        if (callee) {
            const snippet = buildCallSnippet(spec.label, doc.signature);
            if (snippet) {
                item.insertText = new vscode.SnippetString(snippet);
            }
        }
    }
    if (range) {
        item.range = range;
    }
    if (spec.workspace && spec.ns && nsForm && shouldAutoImport(spec.ns, nsForm)) {
        const edit = buildRequireEdit(nsForm, spec.ns, spec.label);
        if (edit) {
            const pos = document.positionAt(edit.insertAt);
            item.additionalTextEdits = [vscode.TextEdit.insert(pos, edit.text)];
            item.detail = `${spec.detail} (auto-add :require)`;
        }
    }
    return item;
}

function shouldAutoImport(targetNs: string, nsForm: NsForm): boolean {
    if (!targetNs) {
        return false;
    }
    if (targetNs === nsForm.name) {
        return false;
    }
    if (targetNs === 'phel.core') {
        return false;
    }
    return true;
}

export class PhelCompletionProvider implements vscode.CompletionItemProvider {
    private readonly baseSpecs: ItemSpec[] = buildBaseSpecs();

    constructor(private readonly indexer?: PhelWorkspaceIndexer) {}

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.CompletionItem[]> {
        const range = document.getWordRangeAtPosition(position, SYMBOL_RE);
        const src = document.getText();
        const merged = this.indexer
            ? combineDocs(this.indexer.index.allDocs(), PHEL_DOCS)
            : [...PHEL_DOCS];
        const specs = [
            ...this.baseSpecs,
            ...workspaceSpecs(this.indexer),
            ...privateFileSpecs(this.indexer, document),
        ];
        const nsForm = parseNsForm(src);
        const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
        const callee = isCalleePosition(linePrefix);
        const items = specs.map((spec) => buildItem(spec, range, merged, document, nsForm, callee));

        // In-scope locals (params, let/loop names, …) are the most relevant
        // suggestions while writing a body, so surface them first.
        for (const name of localsInScopeAt(src, document.offsetAt(position))) {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable);
            item.detail = 'local binding';
            item.sortText = `0_${name}`;
            if (range) {
                item.range = range;
            }
            items.push(item);
        }
        return items;
    }
}
