// Semantic highlighting for locally-bound symbols. TextMate scopes colour
// syntax categories (keywords, strings, numbers); this layer adds *meaning*:
// every `fn`/`defn` parameter and `let`/`loop`/… binding — and each of its
// uses — is tagged so themes can render locals distinctly from globals and
// core symbols. Built on the same `phelScope` analyzer the navigation
// providers use, so highlighting and go-to-definition agree on what a local is.

import * as vscode from 'vscode';
import { collectAllBindings, localOccurrences } from './phelScope';

export const SEMANTIC_LEGEND = new vscode.SemanticTokensLegend(
    ['parameter', 'variable'],
    ['declaration', 'readonly']
);

// Skip the whole pass on very large buffers: semantic tokens are recomputed on
// every edit and the per-binding occurrence walk is superlinear.
const MAX_CHARS = 200_000;

export class PhelSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
    provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens {
        const builder = new vscode.SemanticTokensBuilder(SEMANTIC_LEGEND);
        const src = document.getText();
        if (src.length > MAX_CHARS) {
            return builder.build();
        }

        interface Tok {
            start: number;
            end: number;
            type: string;
            mods: string[];
        }
        const toks: Tok[] = [];
        for (const b of collectAllBindings(src)) {
            const type = b.param ? 'parameter' : 'variable';
            for (const occ of localOccurrences(src, b)) {
                const mods = occ.start === b.declStart ? ['declaration', 'readonly'] : ['readonly'];
                toks.push({ start: occ.start, end: occ.end, type, mods });
            }
        }
        // The builder encodes tokens as deltas, so they must be pushed in
        // document order.
        toks.sort((a, b) => a.start - b.start);
        for (const t of toks) {
            const range = new vscode.Range(
                document.positionAt(t.start),
                document.positionAt(t.end)
            );
            builder.push(range, t.type, t.mods);
        }
        return builder.build();
    }
}
