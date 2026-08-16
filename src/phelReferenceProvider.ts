// Find-all-references for `.phel` symbols. Walks every indexed file plus
// the active document, looking for occurrences of the symbol under the
// cursor (skipping strings / comments / char literals).
//
// When a daemon has indexed the project, its own reference sites are merged in.
// They are worth having because the token scan structurally cannot see a
// namespace-qualified use — `s/includes?` is one token, and its `includes?`
// half has no delimiter in front of it — while the daemon indexed it under
// exactly that spelling. What the daemon cannot do is read an unsaved buffer,
// so its hits in a dirty file give way to what that buffer says now.

import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { parseNsForm } from './phelNsAnalyzer';
import { mergeReferences, type PhelReferencePosition, toVscodePosition } from './phelProjectIndex';
import { findOccurrences } from './phelReferences';
import { resolveLocalAt, localOccurrences } from './phelScope';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';
import { PHEL_SYMBOL_RE } from './phelSymbolToken';
import { folderForUri, uriFromCli } from './phelWorkspace';

export class PhelReferenceProvider implements vscode.ReferenceProvider {
    constructor(private readonly indexer: PhelWorkspaceIndexer) {}

    async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Location[]> {
        const range = document.getWordRangeAtPosition(position, PHEL_SYMBOL_RE);
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
        const [workspace, daemon] = await Promise.all([
            findReferenceLocations(word, document, this.indexer),
            this.daemonReferences(word, document, src),
        ]);
        return mergeReferences(daemon, workspace.map(toHit), dirtyPhelFiles()).map(
            (hit) => hit.location
        );
    }

    /**
     * What the daemon's index holds for the token under the cursor, spelled as
     * it is written here: a qualified `alias/name` is the key the index uses,
     * and a bare name is anchored to this file's own namespace.
     */
    private async daemonReferences(
        word: string,
        document: vscode.TextDocument,
        src: string
    ): Promise<Hit[]> {
        const locations = await this.indexer.findReferences(
            document.uri,
            parseNsForm(src)?.name ?? '',
            word
        );
        const folder = folderForUri(document.uri);
        const out: Hit[] = [];
        for (const location of locations) {
            const position = toVscodePosition(location);
            if (!position) {
                continue;
            }
            // The daemon indexes resolved paths; keyed that way a hit would
            // neither dedupe against the token scan's nor give way to a dirty
            // buffer, and it would point at a file the editor shows twice.
            const uri = uriFromCli(location.uri, folder);
            const start = new vscode.Position(position.line, position.character);
            out.push({
                file: uri.toString(),
                line: position.line,
                character: position.character,
                // The daemon reports where a reference starts, not how far it
                // runs; the token is what was searched for, so it is as long.
                location: new vscode.Location(
                    uri,
                    new vscode.Range(start, start.translate(0, word.length))
                ),
            });
        }
        return out;
    }
}

/** A reference site, carrying the location the editor will show. */
interface Hit extends PhelReferencePosition {
    location: vscode.Location;
}

function toHit(location: vscode.Location): Hit {
    return {
        file: location.uri.toString(),
        line: location.range.start.line,
        character: location.range.start.character,
        location,
    };
}

/** Open documents with unsaved changes, keyed the way `Hit.file` is. */
function dirtyPhelFiles(): Set<string> {
    return new Set(
        vscode.workspace.textDocuments
            .filter((doc) => doc.isDirty && doc.languageId === 'phel')
            .map((doc) => doc.uri.toString())
    );
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

    // Every indexed file, not only the ones that define something: a file can
    // use a name without defining any of its own (a `defbench`, a script).
    for (const file of new Set(indexer.index.files())) {
        if (seen.has(file)) {
            continue;
        }
        seen.add(file);
        // Compare URIs, not `fsPath`: on Windows the same file can be spelled
        // with either drive-letter case, and only the URI form is normalised.
        const uri = vscode.Uri.file(file);
        const key = uri.toString();
        const opened = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
        if (opened) {
            addOccurrencesFromDoc(name, opened, out);
            continue;
        }
        try {
            const text = await fs.readFile(file, 'utf-8');
            addOccurrencesFromText(name, uri, text, out);
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
