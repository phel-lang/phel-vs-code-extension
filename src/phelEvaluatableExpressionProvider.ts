// What debug hover sends to the adapter.
//
// While a debug session is paused, hovering an expression asks this provider
// for the range to evaluate, and VS Code falls back to its own word pattern
// when nobody answers. That pattern is written for C-like identifiers, so it
// cuts every Phel name that carries punctuation: hovering `add-item` evaluates
// `add`, hovering `blank?` evaluates `blank`. Answering with the whole symbol
// token (`PHEL_SYMBOL_RE`, the same shape hover and completion use) is all it
// takes for the adapter's `evaluateRequest` to receive the name the user
// pointed at.

import * as vscode from 'vscode';
import { PHEL_SYMBOL_RE } from './phelSymbolToken';

export class PhelEvaluatableExpressionProvider implements vscode.EvaluatableExpressionProvider {
    provideEvaluatableExpression(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.EvaluatableExpression> {
        const range = document.getWordRangeAtPosition(position, PHEL_SYMBOL_RE);
        return range ? new vscode.EvaluatableExpression(range) : undefined;
    }
}
