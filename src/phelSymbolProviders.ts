// Surface user-defined Phel forms in:
//   * the editor outline (DocumentSymbolProvider)
//   * the "Go to Symbol in Workspace" picker (WorkspaceSymbolProvider)
//
// Both providers reuse the parsed `PhelDoc`s already maintained by the
// workspace indexer. Document symbols re-parse the active buffer so unsaved
// edits show up; workspace symbols read from the persistent index.

import * as vscode from 'vscode';
import { parsePhelFile } from './phelDocs';
import type { PhelDoc, PhelDocKind } from './phelDocs';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';

const NAMESPACE_RE = /\((?:ns|in-ns)\s+([A-Za-z][\w.-]*)/;

/** Icons for the forms whose `kind` is too coarse to distinguish them. */
const SYMBOL_KIND_BY_FORM: Record<string, vscode.SymbolKind> = {
    defstruct: vscode.SymbolKind.Struct,
    defrecord: vscode.SymbolKind.Struct,
    deftype: vscode.SymbolKind.Struct,
    defprotocol: vscode.SymbolKind.Interface,
    definterface: vscode.SymbolKind.Interface,
    defenum: vscode.SymbolKind.Enum,
    defexception: vscode.SymbolKind.Class,
    deftest: vscode.SymbolKind.Event,
    defonce: vscode.SymbolKind.Constant,
};

function symbolKindFor(doc: Pick<PhelDoc, 'kind' | 'form'>): vscode.SymbolKind {
    const byForm = doc.form ? SYMBOL_KIND_BY_FORM[doc.form] : undefined;
    if (byForm !== undefined) {
        return byForm;
    }
    return symbolKindForKind(doc.kind);
}

function symbolKindForKind(kind: PhelDocKind): vscode.SymbolKind {
    switch (kind) {
        case 'fn':
            return vscode.SymbolKind.Function;
        case 'macro':
            return vscode.SymbolKind.Method;
        case 'def':
        default:
            return vscode.SymbolKind.Variable;
    }
}

function detailFor(doc: PhelDoc): string {
    if (doc.signature) {
        return doc.signature;
    }
    return doc.private ? 'private' : '';
}

function detectNamespace(text: string, fallback: string): string {
    const match = text.match(NAMESPACE_RE);
    return match ? match[1] : fallback;
}

export class PhelDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    provideDocumentSymbols(
        document: vscode.TextDocument
    ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
        const text = document.getText();
        const ns = detectNamespace(text, document.uri.fsPath);
        const docs = parsePhelFile(text, ns);
        return docs.map((d) => buildDocumentSymbol(d, document));
    }
}

function buildDocumentSymbol(doc: PhelDoc, document: vscode.TextDocument): vscode.DocumentSymbol {
    const line = doc.line ?? 0;
    const column = doc.column ?? 0;
    const start = new vscode.Position(line, column);
    const end =
        line < document.lineCount
            ? document.lineAt(Math.min(line, document.lineCount - 1)).range.end
            : start;
    const range = new vscode.Range(start, end);
    return new vscode.DocumentSymbol(
        doc.name,
        detailFor(doc),
        symbolKindFor(doc),
        range,
        new vscode.Range(start, start.translate(0, doc.name.length))
    );
}

export class PhelWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
    constructor(private readonly indexer: PhelWorkspaceIndexer) {}

    provideWorkspaceSymbols(query: string): vscode.ProviderResult<vscode.SymbolInformation[]> {
        const lower = query.toLowerCase();
        const out: vscode.SymbolInformation[] = [];
        for (const doc of this.indexer.index.allDocs()) {
            if (!doc.name.toLowerCase().includes(lower)) {
                continue;
            }
            const line = doc.line ?? 0;
            const column = doc.column ?? 0;
            const pos = new vscode.Position(line, column);
            out.push(
                new vscode.SymbolInformation(
                    doc.name,
                    symbolKindFor(doc),
                    doc.ns,
                    new vscode.Location(vscode.Uri.file(doc.sourceFile), pos)
                )
            );
        }
        return out;
    }
}
