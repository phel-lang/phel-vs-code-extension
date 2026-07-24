// Find-all-references for `.phel` symbols. Walks every indexed file plus
// the active document, looking for occurrences of the symbol under the
// cursor (skipping strings / comments / char literals).

import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { findOccurrences } from './phelReferences';
import { resolveLocalAt, localOccurrences } from './phelScope';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';

const SYMBOL_RE = /[A-Za-z0-9_!?*+<>=/\-.':$&%][^\s(){}[\]"',`]*/;

export class PhelReferenceProvider implements vscode.ReferenceProvider {
    constructor(private readonly indexer: PhelWorkspaceIndexer) {}

    async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Location[]> {
        const range = document.getWordRangeAtPosition(position, SYMBOL_RE);
        if (!range) {
            return [];
        }
        // A local binding's references stay within this document and its scope.
        const src = document.getText();
        const local = resolveLocalAt(src, document.offsetAt(range.start));
        if (local) {
            return localOccurrences(src, local).map(
                (occ) =>
                    new vscode.Location(
                        document.uri,
                        new vscode.Range(
                            document.positionAt(occ.start),
                            document.positionAt(occ.end)
                        )
                    )
            );
        }
        const word = document.getText(range);
        return findReferenceLocations(word, document, this.indexer);
    }
}

export async function findReferenceLocations(
    name: string,
    activeDoc: vscode.TextDocument,
    indexer: PhelWorkspaceIndexer
): Promise<vscode.Location[]> {
    const out: vscode.Location[] = [];
    const seen = new Set<string>();

    addOccurrencesFromDoc(name, activeDoc, out);
    seen.add(activeDoc.uri.fsPath);

    const indexedFiles = new Set<string>(indexer.index.allDocs().map((d) => d.sourceFile));
    for (const file of indexedFiles) {
        if (seen.has(file)) {
            continue;
        }
        seen.add(file);
        const opened = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === file);
        if (opened) {
            addOccurrencesFromDoc(name, opened, out);
            continue;
        }
        try {
            const text = await fs.readFile(file, 'utf-8');
            addOccurrencesFromText(name, vscode.Uri.file(file), text, out);
        } catch {
            // File disappeared between indexing and the request.
        }
    }
    return out;
}

function addOccurrencesFromDoc(
    name: string,
    doc: vscode.TextDocument,
    out: vscode.Location[]
): void {
    addOccurrencesFromText(name, doc.uri, doc.getText(), out, doc);
}

function addOccurrencesFromText(
    name: string,
    uri: vscode.Uri,
    text: string,
    out: vscode.Location[],
    doc?: vscode.TextDocument
): void {
    for (const occ of findOccurrences(text, name)) {
        const start = doc ? doc.positionAt(occ.start) : positionAt(text, occ.start);
        const end = doc ? doc.positionAt(occ.end) : positionAt(text, occ.end);
        out.push(new vscode.Location(uri, new vscode.Range(start, end)));
    }
}

function positionAt(text: string, offset: number): vscode.Position {
    const before = text.slice(0, offset);
    const lastNewline = before.lastIndexOf('\n');
    const line = (before.match(/\n/g) ?? []).length;
    const character = lastNewline < 0 ? offset : offset - lastNewline - 1;
    return new vscode.Position(line, character);
}
