// Subtle background highlight for the form enclosing the cursor in the
// active `.phel` editor. Reuses the paredit reader to find the smallest
// enclosing container; falls back to the innermost form when the cursor
// sits on an atom inside a top-level expression.
//
// The decoration is debounced so rapid cursor movement doesn't churn.

import * as vscode from 'vscode';
import { enclosingContainer, pathAt } from './phelParedit';
import { parseAllCached } from './phelParseCache';

const DEBOUNCE_MS = 50;
const SETTING = 'phel.formHighlight.enabled';

export class PhelFormHighlight implements vscode.Disposable {
    private readonly decoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.selectionHighlightBackground'),
        isWholeLine: false,
    });
    private readonly disposables: vscode.Disposable[] = [];
    private timer: NodeJS.Timeout | undefined;

    constructor() {
        this.disposables.push(
            this.decoration,
            vscode.window.onDidChangeTextEditorSelection((e) => this.schedule(e.textEditor)),
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor) {
                    this.schedule(editor);
                }
            }),
            vscode.workspace.onDidChangeTextDocument((e) => {
                if (e.document === vscode.window.activeTextEditor?.document) {
                    this.schedule(vscode.window.activeTextEditor);
                }
            }),
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration(SETTING) && vscode.window.activeTextEditor) {
                    this.schedule(vscode.window.activeTextEditor);
                }
            })
        );
        if (vscode.window.activeTextEditor) {
            this.schedule(vscode.window.activeTextEditor);
        }
    }

    private schedule(editor: vscode.TextEditor): void {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => this.apply(editor), DEBOUNCE_MS);
    }

    private apply(editor: vscode.TextEditor): void {
        if (editor.document.languageId !== 'phel') {
            editor.setDecorations(this.decoration, []);
            return;
        }
        const enabled = vscode.workspace.getConfiguration().get<boolean>(SETTING, true);
        if (!enabled) {
            editor.setDecorations(this.decoration, []);
            return;
        }
        const text = editor.document.getText();
        const offset = editor.document.offsetAt(editor.selection.active);
        const forms = parseAllCached(text);
        const target = enclosingContainer(forms, offset) ?? pathAt(forms, offset).slice(-1)[0];
        if (!target) {
            editor.setDecorations(this.decoration, []);
            return;
        }
        const range = new vscode.Range(
            editor.document.positionAt(target.start),
            editor.document.positionAt(target.end)
        );
        editor.setDecorations(this.decoration, [{ range }]);
    }

    dispose(): void {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
