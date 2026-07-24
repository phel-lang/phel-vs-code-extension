// Flags local bindings that are declared but never read, so VS Code can render
// them faded (via `DiagnosticTag.Unnecessary`). The detector `findUnusedLocals`
// lives in `phelScope` (pure, unit-tested); this module owns the diagnostic
// collection and wires it to the bundled-provider lifecycle so it never runs
// alongside the language server.

import * as vscode from 'vscode';
import { findUnusedLocals } from './phelScope';

const MAX_CHARS = 200_000;

/** Owns a diagnostic collection updated (debounced) as `.phel` buffers change. */
export class PhelUnusedLocals implements vscode.Disposable {
    private readonly collection = vscode.languages.createDiagnosticCollection('phel-unused');
    private readonly subs: vscode.Disposable[] = [];
    private readonly timers = new Map<string, NodeJS.Timeout>();

    constructor() {
        this.subs.push(
            vscode.workspace.onDidOpenTextDocument((d) => this.schedule(d)),
            vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document)),
            vscode.workspace.onDidCloseTextDocument((d) => {
                this.collection.delete(d.uri);
                const key = d.uri.toString();
                const t = this.timers.get(key);
                if (t) {
                    clearTimeout(t);
                    this.timers.delete(key);
                }
            })
        );
        for (const d of vscode.workspace.textDocuments) {
            this.refresh(d);
        }
    }

    private schedule(doc: vscode.TextDocument): void {
        if (doc.languageId !== 'phel') {
            return;
        }
        const key = doc.uri.toString();
        const existing = this.timers.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        this.timers.set(
            key,
            setTimeout(() => {
                this.timers.delete(key);
                this.refresh(doc);
            }, 250)
        );
    }

    private refresh(doc: vscode.TextDocument): void {
        if (doc.languageId !== 'phel') {
            return;
        }
        const src = doc.getText();
        if (src.length > MAX_CHARS) {
            // Too large to analyse on every change; clear stale results.
            this.collection.delete(doc.uri);
            return;
        }
        const diags = findUnusedLocals(src).map((u) => {
            const range = new vscode.Range(doc.positionAt(u.start), doc.positionAt(u.end));
            const diag = new vscode.Diagnostic(
                range,
                `'${u.name}' is bound but never used`,
                vscode.DiagnosticSeverity.Hint
            );
            diag.tags = [vscode.DiagnosticTag.Unnecessary];
            diag.source = 'phel';
            return diag;
        });
        this.collection.set(doc.uri, diags);
    }

    dispose(): void {
        for (const t of this.timers.values()) {
            clearTimeout(t);
        }
        this.timers.clear();
        this.collection.dispose();
        for (const s of this.subs) {
            s.dispose();
        }
    }
}
