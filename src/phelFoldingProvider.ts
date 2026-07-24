// Form-aware folding: replaces VS Code's indentation heuristic with ranges
// derived from the actual `.phel` structure (multi-line forms + comment runs).

import * as vscode from 'vscode';
import { computeFoldRanges } from './phelFolding';

export class PhelFoldingRangeProvider implements vscode.FoldingRangeProvider {
    provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
        return computeFoldRanges(document.getText()).map(
            (r) =>
                new vscode.FoldingRange(
                    r.start,
                    r.end,
                    r.comment ? vscode.FoldingRangeKind.Comment : undefined
                )
        );
    }
}
