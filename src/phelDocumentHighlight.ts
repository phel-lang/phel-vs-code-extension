// Highlight every occurrence of the symbol under the cursor in the current
// `.phel` file. Reuses `findOccurrences` so the same string-/comment-
// skipping rules apply that find-references and rename use.

import * as vscode from 'vscode';
import { findOccurrences } from './phelReferences';
import { resolveLocalAt, localOccurrences } from './phelScope';

const SYMBOL_RE = /[A-Za-z0-9_!?*+<>=/\-.':$&%][^\s(){}[\]"',`]*/;

export class PhelDocumentHighlightProvider implements vscode.DocumentHighlightProvider {
    provideDocumentHighlights(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.DocumentHighlight[]> {
        const range = document.getWordRangeAtPosition(position, SYMBOL_RE);
        if (!range) {
            return null;
        }
        const text = document.getText();

        // For a local, highlight only its scoped occurrences and flag the
        // binding site as a write.
        const local = resolveLocalAt(text, document.offsetAt(range.start));
        if (local) {
            return localOccurrences(text, local).map(
                (occ) =>
                    new vscode.DocumentHighlight(
                        new vscode.Range(
                            document.positionAt(occ.start),
                            document.positionAt(occ.end)
                        ),
                        occ.start === local.declStart
                            ? vscode.DocumentHighlightKind.Write
                            : vscode.DocumentHighlightKind.Read
                    )
            );
        }

        const word = document.getText(range);
        return findOccurrences(text, word).map(
            (occ) =>
                new vscode.DocumentHighlight(
                    new vscode.Range(document.positionAt(occ.start), document.positionAt(occ.end)),
                    vscode.DocumentHighlightKind.Text
                )
        );
    }
}
