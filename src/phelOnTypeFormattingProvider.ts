import * as vscode from 'vscode';
import { reindentLine } from './phelIndent';

/**
 * Indents the line being typed the way `phel format` would, so format-on-save
 * never has to move it again. Two moments are worth acting on:
 *
 *   * Enter — the fresh line gets the indentation its position asks for,
 *     instead of whatever the editor copied from the line above;
 *   * a closing bracket typed as the first thing on its line — until it is
 *     there, the form is still open, so the line could not be placed before.
 *
 * Everything else is left alone: on-type formatting that rewrites text the
 * user is in the middle of typing is worse than none.
 */
export class PhelOnTypeFormattingProvider implements vscode.OnTypeFormattingEditProvider {
    provideOnTypeFormattingEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        ch: string,
        _options: vscode.FormattingOptions,
        _token: vscode.CancellationToken
    ): vscode.TextEdit[] {
        if (!isEnabled()) {
            return [];
        }
        if (ch !== '\n' && !closesLine(document, position, ch)) {
            return [];
        }
        // The whole buffer: what a line is indented to is decided by the forms
        // enclosing it, and those start anywhere above.
        const lineStart = document.offsetAt(new vscode.Position(position.line, 0));
        const edit = reindentLine(document.getText(), lineStart);
        if (!edit) {
            return [];
        }
        return [
            vscode.TextEdit.replace(
                new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)),
                // Spaces, whatever `options.insertSpaces` says: the CLI writes
                // spaces, and alignment under a column cannot be done in tabs.
                edit.text
            ),
        ];
    }
}

/** Whether `ch` is a closing bracket and the first non-blank character of its line. */
function closesLine(document: vscode.TextDocument, position: vscode.Position, ch: string): boolean {
    if (ch !== ')' && ch !== ']' && ch !== '}') {
        return false;
    }
    return (
        document.lineAt(position.line).firstNonWhitespaceCharacterIndex === position.character - 1
    );
}

function isEnabled(): boolean {
    return vscode.workspace.getConfiguration('phel').get<boolean>('format.onType', true);
}
