// Lightbulb refactorings for `.phel`, inspired by clojure-lsp / Calva but
// scoped to what the bundled analyzer can do reliably:
//   - Thread first / last (`->` / `->>`) and unwind, over the form at the cursor
//   - Cycle a collection's delimiters: `(` → `[` → `{` → `(`
//   - Quick-fix: add a missing `:require` for a known symbol
//   - Quick-fix: remove a `:require` (or one `:refer`) nothing in the file uses
//   - Quick-fix: rename a core function Phel 0.50 removed to its replacement
//   - Source action: sort the `(:require ...)` entries by namespace
// The structural transforms live in `phelRefactor` (pure, unit-tested); this
// module adapts them to VS Code code actions.

import * as vscode from 'vscode';
import { threadForm, unthreadForm, cycleCollection, type RefactorEdit } from './phelRefactor';
import { lookupSymbol } from './phelDocsLookup';
import { parseNsForm, buildRequireEdit } from './phelNsAnalyzer';
import {
    findUnusedRequires,
    removeRequireEdit,
    requireIssueIn,
    sortRequiresEdit,
    type NsHygieneIssue,
} from './phelNsHygiene';
import { LINT_UNUSED_REQUIRE_CODE } from './phelNsHygieneProvider';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';
import { PHEL_SYMBOL_RE } from './phelSymbolToken';
import { mergedDocs } from './phelProviderSupport';
import { findMigrationIssues } from './phelMigration';
import { deprecatedDefinitionsFor, migrationEnabled } from './phelMigrationProvider';

export class PhelCodeActionProvider implements vscode.CodeActionProvider {
    static readonly kinds = [
        vscode.CodeActionKind.RefactorRewrite,
        vscode.CodeActionKind.QuickFix,
        // `editor.codeActionsOnSave: { "source.organizeImports": true }` only
        // reaches a provider that declares the kind.
        vscode.CodeActionKind.SourceOrganizeImports,
    ];

    constructor(private readonly indexer: PhelWorkspaceIndexer) {}

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext
    ): vscode.CodeAction[] {
        const src = document.getText();
        const offset = document.offsetAt(range.start);
        const actions: vscode.CodeAction[] = [];

        const rewrite = (title: string, edit: RefactorEdit | null): void => {
            if (!edit) {
                return;
            }
            const action = new vscode.CodeAction(title, vscode.CodeActionKind.RefactorRewrite);
            action.edit = editFor(document, edit);
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
        actions.push(...unusedRequireActions(document, src, offset, context));
        const sorted = sortRequiresEdit(src);
        if (sorted) {
            const action = new vscode.CodeAction(
                'Sort requires',
                vscode.CodeActionKind.SourceOrganizeImports
            );
            action.edit = editFor(document, sorted);
            actions.push(action);
        }
        actions.push(...migrationActions(document, src, offset, this.indexer));
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

/**
 * Offer to drop a `(:require ...)` entry, or one name out of its `:refer`,
 * that nothing in the file uses.
 *
 * Two sources, because two analyzers report this. Ours is re-derived from the
 * source the way `migrationActions` is, so the fix works with the hints
 * switched off and right after an edit. `phel lint`'s `phel/unused-require` is
 * read off the diagnostic instead: it ran over the whole project, it may well
 * have found an entry this analyzer counts as used, and it anchors its range
 * differently - so the entry is looked up by position and taken at its word.
 */
function unusedRequireActions(
    document: vscode.TextDocument,
    src: string,
    offset: number,
    context: vscode.CodeActionContext
): vscode.CodeAction[] {
    const issues = new Map<string, NsHygieneIssue>();
    const remember = (issue: NsHygieneIssue | null): void => {
        if (issue) {
            issues.set(`${issue.kind}:${issue.start}:${issue.end}`, issue);
        }
    };
    for (const issue of findUnusedRequires(src)) {
        if (offset >= issue.start && offset <= issue.end) {
            remember(issue);
        }
    }
    for (const diagnostic of context.diagnostics) {
        if (diagnostic.code !== LINT_UNUSED_REQUIRE_CODE) {
            continue;
        }
        remember(
            requireIssueIn(
                src,
                document.offsetAt(diagnostic.range.start),
                document.offsetAt(diagnostic.range.end)
            )
        );
    }

    const actions: vscode.CodeAction[] = [];
    for (const issue of issues.values()) {
        const edit = removeRequireEdit(src, issue);
        if (!edit) {
            continue;
        }
        const title =
            issue.kind === 'refer'
                ? `Remove unused refer '${issue.name}'`
                : `Remove unused require '${issue.ns}'`;
        const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        action.edit = editFor(document, edit);
        action.isPreferred = true;
        actions.push(action);
    }
    return actions;
}

/** A one-replacement `WorkspaceEdit` over `document`. */
function editFor(
    document: vscode.TextDocument,
    edit: { start: number; end: number; text: string }
): vscode.WorkspaceEdit {
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.replace(
        document.uri,
        new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)),
        edit.text
    );
    return workspaceEdit;
}

/**
 * Offer the rewrite for a removed-or-deprecated use under the cursor.
 *
 * Re-derives the issues from the source rather than reading them back off
 * `CodeActionContext.diagnostics`: the analyzer is pure and cheap, and it keeps
 * the fix working when the diagnostics are switched off or have not yet been
 * recomputed after an edit.
 *
 * Only issues carrying a `fix` produce an action. `php/->` and `set-var`
 * deliberately do not: their replacements rearrange the arguments or depend on
 * the intent, so a head swap would silently write the wrong code. Nor does a
 * call to a workspace definition marked `:deprecated`: `:superseded-by` names
 * the replacement without promising the same arguments.
 */
function migrationActions(
    document: vscode.TextDocument,
    src: string,
    offset: number,
    indexer: PhelWorkspaceIndexer
): vscode.CodeAction[] {
    if (!migrationEnabled()) {
        return [];
    }
    const actions: vscode.CodeAction[] = [];
    const issues = findMigrationIssues(src, {
        deprecatedDefinitions: deprecatedDefinitionsFor(indexer, document.uri.fsPath),
    });
    for (const issue of issues) {
        if (!issue.fix || offset < issue.start || offset > issue.end) {
            continue;
        }
        const action = new vscode.CodeAction(issue.fix.title, vscode.CodeActionKind.QuickFix);
        action.edit = new vscode.WorkspaceEdit();
        for (const edit of issue.fix.edits) {
            action.edit.replace(
                document.uri,
                new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)),
                edit.text
            );
        }
        action.isPreferred = true;
        actions.push(action);
    }
    return actions;
}
