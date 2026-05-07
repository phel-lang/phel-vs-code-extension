import * as vscode from 'vscode';
import { PHEL_DOCS } from './phelCoreDocs';
import { lookupSymbol } from './phelDocsLookup';
import { aliasMapFromSource } from './phelNsAnalyzer';
import {
    aritiesOf,
    clampActiveParam,
    findCurrentCall,
    parseSignatureParams,
    pickActiveSignature,
} from './phelSignatureHelp';
import { combineDocs } from './phelWorkspaceIndex';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';

export class PhelSignatureHelpProvider implements vscode.SignatureHelpProvider {
    constructor(private readonly indexer?: PhelWorkspaceIndexer) {}

    provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.SignatureHelp> {
        const offset = document.offsetAt(position);
        const call = findCurrentCall(document.getText(), offset);
        if (!call) {
            return null;
        }

        const merged = this.indexer
            ? combineDocs(this.indexer.index.allDocs(), PHEL_DOCS)
            : [...PHEL_DOCS];
        const aliases = aliasMapFromSource(document.getText());
        const doc = lookupSymbol(call.callee, merged, aliases);
        if (!doc) {
            return null;
        }

        const arities = aritiesOf(doc);
        if (arities.length === 0) {
            return null;
        }

        const help = new vscode.SignatureHelp();
        help.signatures = arities.map((arity) => buildSignature(arity, doc.doc));
        help.activeSignature = pickActiveSignature(arities, call.activeArg);
        const params = parseSignatureParams(arities[help.activeSignature]);
        const clamped = clampActiveParam(params, call.activeArg);
        help.activeParameter = clamped < 0 ? 0 : clamped;
        return help;
    }
}

function buildSignature(signature: string, docstring?: string): vscode.SignatureInformation {
    const info = new vscode.SignatureInformation(signature);
    info.parameters = parseSignatureParams(signature).map(
        (label) => new vscode.ParameterInformation(label)
    );
    if (docstring) {
        const md = new vscode.MarkdownString(docstring);
        md.isTrusted = false;
        md.supportHtml = false;
        info.documentation = md;
    }
    return info;
}
