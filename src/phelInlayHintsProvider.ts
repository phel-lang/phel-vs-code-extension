// Parameter-name inlay hints, off by default (`phel.inlayHints.parameterNames`).
//
// The placement logic is pure and lives in `phelInlayHints`; this file decides
// which head symbols count as functions and turns offsets into positions.
//
// Only `kind: 'fn'` docs are resolved. A macro binds its arguments by shape
// rather than by position — labelling `(let [x 1] …)` with `let`'s parameter
// names would be noise at best — and the special forms have no doc record at
// all, which lands them on the same side of the line.

import * as vscode from 'vscode';
import { lookupSymbol } from './phelDocsLookup';
import { parameterHints } from './phelInlayHints';
import { aliasMapFromSource } from './phelNsAnalyzer';
import { mergedDocs } from './phelProviderSupport';
import { aritiesOf } from './phelSignatureHelp';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';

const SETTING = 'inlayHints.parameterNames';

export class PhelInlayHintsProvider implements vscode.InlayHintsProvider, vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<void>();
    private readonly subs: vscode.Disposable[] = [];

    /** VS Code re-asks for hints whenever this fires. */
    readonly onDidChangeInlayHints = this.emitter.event;

    constructor(private readonly indexer?: PhelWorkspaceIndexer) {
        this.subs.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration(`phel.${SETTING}`)) {
                    this.emitter.fire();
                }
            })
        );
        if (indexer) {
            // A workspace symbol only becomes labelable once the index reaches
            // it; without this the hints for your own functions would appear
            // one edit late.
            this.subs.push(indexer.onDidChange(() => this.emitter.fire()));
        }
    }

    provideInlayHints(
        document: vscode.TextDocument,
        range: vscode.Range
    ): vscode.ProviderResult<vscode.InlayHint[]> {
        if (!vscode.workspace.getConfiguration('phel').get<boolean>(SETTING, false)) {
            return [];
        }

        const src = document.getText();
        const docs = mergedDocs(this.indexer);
        const aliases = aliasMapFromSource(src);
        const resolve = (name: string): readonly string[] | undefined => {
            const doc = lookupSymbol(name, docs, aliases);
            if (!doc || doc.kind !== 'fn') {
                return undefined;
            }
            const arities = aritiesOf(doc);
            return arities.length > 0 ? arities : undefined;
        };

        const bounds = { start: document.offsetAt(range.start), end: document.offsetAt(range.end) };
        return parameterHints(src, bounds, resolve).map((h) => {
            const hint = new vscode.InlayHint(
                document.positionAt(h.offset),
                h.label,
                vscode.InlayHintKind.Parameter
            );
            hint.paddingRight = true;
            hint.tooltip = h.signature;
            return hint;
        });
    }

    dispose(): void {
        for (const s of this.subs) {
            s.dispose();
        }
        this.emitter.dispose();
    }
}
