import * as vscode from 'vscode';
import { lookupSymbol } from './phelDocsLookup';
import { aliasMapFromSource } from './phelNsAnalyzer';
import {
    aritiesOf,
    clampActiveParam,
    findCurrentCall,
    parseSignatureParams,
    pickActiveSignature,
} from './phelSignatureHelp';
import { resolveLocalAt } from './phelScope';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';
import { mergedDocs, plainMarkdown } from './phelProviderSupport';

export class PhelSignatureHelpProvider implements vscode.SignatureHelpProvider {
    constructor(private readonly indexer?: PhelWorkspaceIndexer) {}

    provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.SignatureHelp> {
        const offset = document.offsetAt(position);
        const src = document.getText();
        const call = findCurrentCall(src, offset);
        if (!call) {
            return null;
        }

        // A local in callee position — `(f x)` where `f` is a let-bound fn —
        // has no signature of its own, and most short names collide with a
        // `phel.core` function whose signature would be simply wrong here.
        if (resolveLocalAt(src, call.calleeStart)) {
            return null;
        }

        const merged = mergedDocs(this.indexer);
        const aliases = aliasMapFromSource(src);
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
        const md = plainMarkdown(docstring);
        info.documentation = md;
    }
    return info;
}
