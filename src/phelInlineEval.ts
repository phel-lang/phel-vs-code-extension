// Calva-style inline evaluation results: after evaluating a form, its value is
// shown as a dimmed `=> …` decoration at the end of the form's last line. The
// decoration is cleared as soon as the buffer changes, so a stale result never
// lingers next to edited code.

import * as vscode from 'vscode';

export interface InlineResult {
    text: string;
    isError: boolean;
}

interface DocDecorations {
    ok: vscode.DecorationOptions[];
    err: vscode.DecorationOptions[];
}

export class PhelInlineEval implements vscode.Disposable {
    private readonly okType = vscode.window.createTextEditorDecorationType({
        after: {
            margin: '0 0 0 1.5rem',
            color: new vscode.ThemeColor('editorCodeLens.foreground'),
            fontStyle: 'italic',
        },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    private readonly errType = vscode.window.createTextEditorDecorationType({
        after: {
            margin: '0 0 0 1.5rem',
            color: new vscode.ThemeColor('errorForeground'),
            fontStyle: 'italic',
        },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    private readonly perDoc = new Map<string, DocDecorations>();
    private readonly subs: vscode.Disposable[] = [];

    constructor() {
        this.subs.push(
            vscode.workspace.onDidChangeTextDocument((e) => this.clear(e.document)),
            vscode.window.onDidChangeVisibleTextEditors(() => this.reapply())
        );
    }

    /** Show `=> result` at the end of the line containing `formEndOffset`. */
    show(editor: vscode.TextEditor, formEndOffset: number, result: InlineResult): void {
        const doc = editor.document;
        const lastCharOffset = Math.max(0, Math.min(formEndOffset, doc.getText().length) - 1);
        const line = doc.positionAt(lastCharOffset).line;
        const eol = doc.lineAt(line).range.end;
        const option: vscode.DecorationOptions = {
            range: new vscode.Range(eol, eol),
            renderOptions: { after: { contentText: `  => ${result.text}` } },
        };

        const key = doc.uri.toString();
        const bucket = this.perDoc.get(key) ?? { ok: [], err: [] };
        // Replace any existing decoration on the same line.
        const sameLine = (o: vscode.DecorationOptions): boolean => o.range.start.line === line;
        bucket.ok = bucket.ok.filter((o) => !sameLine(o));
        bucket.err = bucket.err.filter((o) => !sameLine(o));
        if (result.isError) {
            bucket.err.push(option);
        } else {
            bucket.ok.push(option);
        }
        this.perDoc.set(key, bucket);
        editor.setDecorations(this.okType, bucket.ok);
        editor.setDecorations(this.errType, bucket.err);
    }

    private clear(doc: vscode.TextDocument): void {
        const key = doc.uri.toString();
        if (!this.perDoc.has(key)) {
            return;
        }
        this.perDoc.delete(key);
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.toString() === key) {
                editor.setDecorations(this.okType, []);
                editor.setDecorations(this.errType, []);
            }
        }
    }

    private reapply(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            const bucket = this.perDoc.get(editor.document.uri.toString());
            if (bucket) {
                editor.setDecorations(this.okType, bucket.ok);
                editor.setDecorations(this.errType, bucket.err);
            }
        }
    }

    dispose(): void {
        this.okType.dispose();
        this.errType.dispose();
        for (const s of this.subs) {
            s.dispose();
        }
        this.perDoc.clear();
    }
}
