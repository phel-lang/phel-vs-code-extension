// Per-editor expand/shrink commands. Maintains a stack of selections so
// "shrink" undoes the most recent expansion.
//
// The stack is keyed by `TextEditor` (each editor instance is identity-stable
// for the lifetime of the document). If the user changes the selection
// outside of these commands, the stack is reset so we never restore a stale
// span.

import * as vscode from 'vscode';
import { expandSelection } from './phelSelection';

interface ExpansionEntry {
    start: number;
    end: number;
}

const stacks = new WeakMap<vscode.TextEditor, ExpansionEntry[]>();
let mutating = false;

function snapshot(editor: vscode.TextEditor): ExpansionEntry {
    const sel = editor.selection;
    return {
        start: editor.document.offsetAt(sel.start),
        end: editor.document.offsetAt(sel.end),
    };
}

function selectRange(editor: vscode.TextEditor, span: ExpansionEntry): void {
    const start = editor.document.positionAt(span.start);
    const end = editor.document.positionAt(span.end);
    mutating = true;
    editor.selection = new vscode.Selection(start, end);
    editor.revealRange(new vscode.Range(start, end));
    mutating = false;
}

function topMatchesCurrent(editor: vscode.TextEditor): boolean {
    const stack = stacks.get(editor);
    if (!stack || stack.length === 0) {
        return false;
    }
    const top = stack[stack.length - 1];
    const current = snapshot(editor);
    return top.start === current.start && top.end === current.end;
}

export function expand(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'phel') {
        return;
    }
    const current = snapshot(editor);
    const next = expandSelection(editor.document.getText(), current.start, current.end);
    if (!next) {
        return;
    }
    let stack = stacks.get(editor);
    if (!stack || !topMatchesCurrent(editor)) {
        stack = [current];
        stacks.set(editor, stack);
    }
    stack.push(next);
    selectRange(editor, next);
}

export function shrink(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'phel') {
        return;
    }
    const stack = stacks.get(editor);
    if (!stack || stack.length < 2 || !topMatchesCurrent(editor)) {
        return;
    }
    stack.pop();
    selectRange(editor, stack[stack.length - 1]);
}

export function registerSelectionCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('phel.selection.expand', expand),
        vscode.commands.registerCommand('phel.selection.shrink', shrink),
        vscode.window.onDidChangeTextEditorSelection((e) => {
            if (mutating) {
                return;
            }
            stacks.delete(e.textEditor);
        })
    );
}
