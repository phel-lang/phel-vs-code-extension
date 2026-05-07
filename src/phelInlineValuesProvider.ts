// Inline-values during Phel debug sessions.
//
// VS Code calls `provideInlineValues` for the visible range above the
// stopped line. We extract candidate symbol names with `findInlineCandidates`
// and return one `InlineValueVariableLookup` per occurrence; VS Code asks
// the active debug session to look each one up. Names not present in the
// current scope are silently dropped, so this fails gracefully when the
// Phel-to-PHP name doesn't match a live variable.
//
// Surfaces real values for plain locals (the common case after `let`/`for`)
// and stays out of the way when the binding doesn't survive compilation.

import * as vscode from 'vscode';
import { findInlineCandidates } from './phelInlineValues';

export class PhelInlineValuesProvider implements vscode.InlineValuesProvider {
    provideInlineValues(
        document: vscode.TextDocument,
        viewport: vscode.Range,
        context: vscode.InlineValueContext
    ): vscode.ProviderResult<vscode.InlineValue[]> {
        const fromLine = viewport.start.line;
        const toLine = Math.min(context.stoppedLocation.end.line, viewport.end.line);
        if (toLine < fromLine) {
            return [];
        }
        const occurrences = findInlineCandidates(document.getText(), fromLine, toLine);
        return occurrences.map(
            (o) =>
                new vscode.InlineValueVariableLookup(
                    new vscode.Range(o.line, o.column, o.line, o.column + o.name.length),
                    o.name,
                    false
                )
        );
    }
}
