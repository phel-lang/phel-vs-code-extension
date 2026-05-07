// Thin VS Code wrapper around `phelParedit`. Each command reads the active
// editor's text + cursor, runs the corresponding pure operation, then applies
// a single text edit and (optionally) repositions the cursor.

import * as vscode from 'vscode';
import {
    barfBackward,
    barfForward,
    raise as raiseForm,
    slurpBackward,
    slurpForward,
    wrap,
    type PareditEdit,
} from './phelParedit';

type PareditOp = (src: string, offset: number) => PareditEdit | null;

async function runOp(op: PareditOp): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'phel') {
        return;
    }
    const doc = editor.document;
    const pos = editor.selection.active;
    const offset = doc.offsetAt(pos);
    const edit = op(doc.getText(), offset);
    if (!edit) {
        return;
    }
    const range = new vscode.Range(
        doc.positionAt(edit.replaceStart),
        doc.positionAt(edit.replaceEnd)
    );
    await editor.edit((b) => b.replace(range, edit.replacement));
    if (typeof edit.cursor === 'number') {
        const newPos = editor.document.positionAt(edit.cursor);
        editor.selection = new vscode.Selection(newPos, newPos);
    }
}

export function registerPareditCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('phel.paredit.slurpForward', () => runOp(slurpForward)),
        vscode.commands.registerCommand('phel.paredit.barfForward', () => runOp(barfForward)),
        vscode.commands.registerCommand('phel.paredit.slurpBackward', () => runOp(slurpBackward)),
        vscode.commands.registerCommand('phel.paredit.barfBackward', () => runOp(barfBackward)),
        vscode.commands.registerCommand('phel.paredit.raise', () => runOp(raiseForm)),
        vscode.commands.registerCommand('phel.paredit.wrapRound', () =>
            runOp((src, off) => wrap(src, off, '('))
        ),
        vscode.commands.registerCommand('phel.paredit.wrapSquare', () =>
            runOp((src, off) => wrap(src, off, '['))
        ),
        vscode.commands.registerCommand('phel.paredit.wrapCurly', () =>
            runOp((src, off) => wrap(src, off, '{'))
        )
    );
}
