// "N references" above every definition in the open file, and the peek that
// opens when it is clicked.
//
// The count is a map lookup per definition, never a search: the workspace index
// tallies the symbol tokens of every file it reads, so the lens only sums what
// is already there and subtracts the definition's own name. Counting the way
// find-references searches — reading every indexed file — would be a full
// workspace scan per lens, on every keystroke.
//
// The two places where a tally and a search can disagree are handled here:
// an unsaved buffer, whose own tally is recomputed from what it says now (the
// index has only what was last saved), and a definition that is a `deftest`,
// which nothing calls by name and which already carries a Run test lens.
//
// The list itself is built on click, by the merged reference provider, so what
// the peek shows is exactly what shift+F12 would.

import * as vscode from 'vscode';
import { derive } from './phelParseCache';
import { countSymbolTokens, firstSymbolTokenOffsets } from './phelReferences';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';
import type { WorkspaceDoc } from './phelWorkspaceIndex';

const ENABLED_KEY = 'references.codeLens';

/** Internal: the lens click, which needs the sites before it can peek them. */
const SHOW_REFERENCES_COMMAND = 'phel.showReferences';

/** Forms whose name is an entry point for a runner, not a symbol anyone calls. */
const NOT_REFERENCED_BY_NAME = new Set(['deftest']);

export class PhelReferencesCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChange.event;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly indexer: PhelWorkspaceIndexer) {
        this.disposables.push(
            // A save anywhere in the workspace changes what the counts are.
            indexer.onDidChange(() => this._onDidChange.fire()),
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration(`phel.${ENABLED_KEY}`)) {
                    this._onDidChange.fire();
                }
            })
        );
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (!isEnabled(document.uri)) {
            return [];
        }
        const docs = this.indexer.index
            .docsForFile(document.uri.fsPath)
            .filter((doc) => !NOT_REFERENCED_BY_NAME.has(doc.form ?? ''));
        if (docs.length === 0) {
            return [];
        }
        const src = document.getText();
        const offsets = derive(src, 'firstSymbolTokens', () => firstSymbolTokenOffsets(src));
        const dirty = dirtyPhelDocuments();

        const lenses: vscode.CodeLens[] = [];
        for (const doc of docs) {
            // The index knows where the *form* starts; the reference search
            // needs a position that sits on the name itself.
            const at = offsets.get(doc.name);
            const position =
                at === undefined
                    ? new vscode.Position(doc.line ?? 0, doc.column ?? 0)
                    : document.positionAt(at);
            lenses.push(
                new vscode.CodeLens(new vscode.Range(position, position), {
                    title: titleFor(this.countFor(doc, dirty)),
                    command: SHOW_REFERENCES_COMMAND,
                    arguments: [document.uri, position],
                })
            );
        }
        return lenses;
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this._onDidChange.dispose();
    }

    /**
     * How often the name is written anywhere in the workspace, minus its own
     * definition. Every unsaved buffer replaces the tally the index holds for
     * its file, so a use typed a second ago counts and one just deleted does
     * not.
     */
    private countFor(doc: WorkspaceDoc, dirty: readonly vscode.TextDocument[]): number {
        let total = this.indexer.index.occurrenceCount(doc.name);
        for (const buffer of dirty) {
            const src = buffer.getText();
            const counts = derive(src, 'symbolTokenCounts', () => countSymbolTokens(src));
            total += counts.get(doc.name) ?? 0;
            total -= this.indexer.index.occurrenceCountIn(buffer.uri.fsPath, doc.name);
        }
        return Math.max(total - 1, 0);
    }
}

/**
 * Register the lens and the command it clicks through to. The command is not
 * contributed in `package.json`: it takes a uri and a position, so it means
 * nothing from the palette.
 */
export function registerReferencesCodeLens(
    context: vscode.ExtensionContext,
    indexer: PhelWorkspaceIndexer
): void {
    const provider = new PhelReferencesCodeLensProvider(indexer);
    context.subscriptions.push(
        provider,
        vscode.languages.registerCodeLensProvider('phel', provider),
        vscode.commands.registerCommand(SHOW_REFERENCES_COMMAND, showReferences)
    );
}

/**
 * Ask the reference provider for the sites, then hand them to the editor's own
 * peek. Done on click rather than in the lens: building the list means reading
 * every indexed file, which is a price worth paying once, not once per lens.
 */
async function showReferences(uri: vscode.Uri, position: vscode.Position): Promise<void> {
    const locations =
        (await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            uri,
            position
        )) ?? [];
    await vscode.commands.executeCommand('editor.action.showReferences', uri, position, locations);
}

function titleFor(count: number): string {
    if (count === 0) {
        return 'no references';
    }
    return count === 1 ? '1 reference' : `${count} references`;
}

function dirtyPhelDocuments(): vscode.TextDocument[] {
    return vscode.workspace.textDocuments.filter((doc) => doc.isDirty && doc.languageId === 'phel');
}

function isEnabled(uri: vscode.Uri): boolean {
    return vscode.workspace.getConfiguration('phel', uri).get<boolean>(ENABLED_KEY, true);
}
