// Native structural selection: expanding the selection (Shift+Alt+Right) grows
// it through the enclosing forms — atom → list → outer list → … — using the
// same reader the paredit commands use. Complements the stack-based
// expand/shrink commands with VS Code's built-in smart-select.

import * as vscode from 'vscode';
import { parseAll, pathAt } from './phelParedit';

export class PhelSelectionRangeProvider implements vscode.SelectionRangeProvider {
    provideSelectionRanges(
        document: vscode.TextDocument,
        positions: vscode.Position[]
    ): vscode.SelectionRange[] {
        const forms = parseAll(document.getText());
        return positions.map((pos) => {
            const path = pathAt(forms, document.offsetAt(pos));
            // Build outermost → innermost so each form's parent is the one
            // enclosing it; the innermost node is returned.
            let range: vscode.SelectionRange | undefined;
            for (const f of path) {
                const r = new vscode.Range(
                    document.positionAt(f.start),
                    document.positionAt(f.end)
                );
                range = new vscode.SelectionRange(r, range);
            }
            return range ?? new vscode.SelectionRange(new vscode.Range(pos, pos));
        });
    }
}
