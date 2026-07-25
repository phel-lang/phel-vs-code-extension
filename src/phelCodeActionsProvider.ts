// Lightbulb refactorings for `.phel`, inspired by clojure-lsp / Calva but
// scoped to what the bundled analyzer can do reliably:
//   - Thread first / last (`->` / `->>`) and unwind, over the form at the cursor
//   - Cycle a collection's delimiters: `(` → `[` → `{` → `(`
//   - Quick-fix: add a missing `:require` for a known symbol
// The structural transforms live in `phelRefactor` (pure, unit-tested); this
// module adapts them to VS Code code actions.

import * as vscode from 'vscode';
import { threadForm, unthreadForm, cycleCollection, type RefactorEdit } from './phelRefactor';
import { lookupSymbol } from './phelDocsLookup';
import { parseNsForm, buildRequireEdit } from './phelNsAnalyzer';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';
import { PHEL_SYMBOL_RE } from './phelSymbolToken';
import { mergedDocs } from './phelProviderSupport';

export class PhelCodeActionProvider implements vscode.CodeActionProvider {
    static readonly kinds = [vscode.CodeActionKind.RefactorRewrite, vscode.CodeActionKind.QuickFix];

    constructor(private readonly indexer: PhelWorkspaceIndexer) {}

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection
    ): vscode.CodeAction[] {
        const src = document.getText();
        const offset = document.offsetAt(range.start);
        const actions: vscode.CodeAction[] = [];

        const rewrite = (title: string, edit: RefactorEdit | null): void => {
            if (!edit) {
                return;
            }
            const action = new vscode.CodeAction(title, vscode.CodeActionKind.RefactorRewrite);
            action.edit = new vscode.WorkspaceEdit();
            action.edit.replace(
                document.uri,
                new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)),
                edit.text
            );
            actions.push(action);
        };

        rewrite('Thread first (->)', threadForm(src, offset, false));
        rewrite('Thread last (->>)', threadForm(src, offset, true));
        rewrite('Unwind thread', unthreadForm(src, offset));
        rewrite('Cycle collection () [] {}', cycleCollection(src, offset));

        const req = this.addRequireAction(document, range, src);
        if (req) {
            actions.push(req);
        }
        return actions;
    }

    /** Offer to add a `:require` when the symbol at the cursor is a known, un-imported name. */
    private addRequireAction(
        document: vscode.TextDocument,
        range: vscode.Range,
        src: string
    ): vscode.CodeAction | null {
        const wordRange = document.getWordRangeAtPosition(range.start, PHEL_SYMBOL_RE);
        if (!wordRange) {
            return null;
        }
        const word = document.getText(wordRange);
        // Only bare names: qualified/keyword tokens need `:as`, which the
        // require builder does not synthesise.
        if (word.includes('/') || word.startsWith(':')) {
            return null;
        }
        const nsForm = parseNsForm(src);
        if (!nsForm) {
            return null;
        }
        const merged = mergedDocs(this.indexer);
        const doc = lookupSymbol(word, merged);
        if (!doc || !doc.ns) {
            return null;
        }
        const edit = buildRequireEdit(nsForm, doc.ns, word);
        if (!edit) {
            return null; // already required, core, or same namespace
        }
        const action = new vscode.CodeAction(
            `Add (:require [${doc.ns} :refer [${word}]])`,
            vscode.CodeActionKind.QuickFix
        );
        action.edit = new vscode.WorkspaceEdit();
        action.edit.insert(document.uri, document.positionAt(edit.insertAt), edit.text);
        return action;
    }
}
