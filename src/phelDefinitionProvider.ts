// Go to Definition. Four sources, in the order that can be trusted:
//
//   1. a local binding, which resolves inside this document and nowhere else;
//   2. a namespace inside `(ns … (:require …))`, which the daemon's index maps
//      to the `ns` form of the file that declares it;
//   3. the daemon's `resolveSymbol`, which knows *which* namespace a name
//      belongs to and so can tell two same-named definitions apart;
//   4. the workspace index plus the bundled core docs, which is what the whole
//      feature was before a daemon existed and stays the answer whenever there
//      is none, it errors, or it knows nothing about the symbol.

import * as vscode from 'vscode';
import { lookupSymbol } from './phelDocsLookup';
import { aliasMapFromSource, normalizeNs, parseNsForm } from './phelNsAnalyzer';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';
import {
    daemonSymbolKey,
    definitionLocation,
    namespaceLocationFor,
    toVscodePosition,
} from './phelProjectIndex';
import { resolveLocalAt } from './phelScope';
import { PHEL_SYMBOL_RE } from './phelSymbolToken';
import { mergedDocs } from './phelProviderSupport';
import { folderForUri, uriFromCli } from './phelWorkspace';

export class PhelDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private readonly indexer: PhelWorkspaceIndexer) {}

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Definition | null> {
        const range = document.getWordRangeAtPosition(position, PHEL_SYMBOL_RE);
        if (!range) {
            return null;
        }
        const word = document.getText(range);

        // A locally-bound symbol (fn/let/loop param, catch var, …) resolves to
        // its binding site in this document, never to a same-named global.
        const src = document.getText();
        const offset = document.offsetAt(range.start);
        const local = resolveLocalAt(src, offset);
        if (local) {
            return new vscode.Location(
                document.uri,
                new vscode.Range(
                    document.positionAt(local.declStart),
                    document.positionAt(local.declEnd)
                )
            );
        }

        return (
            this.requiredNamespace(document, src, word, offset) ??
            (await this.fromDaemon(document, src, word)) ??
            this.fromWorkspaceIndex(document, src, word)
        );
    }

    /** The `ns` form of a namespace named in this file's `(:require …)`. */
    private requiredNamespace(
        document: vscode.TextDocument,
        src: string,
        word: string,
        offset: number
    ): vscode.Location | null {
        const index = this.indexer.projectIndexFor(document.uri);
        const clause = parseNsForm(src)?.requireClause;
        if (!index || !clause || offset < clause.start || offset >= clause.end) {
            return null;
        }
        // The clause spans the `:refer` names too, so the token has to *be* one
        // of the required namespaces, not merely sit inside the clause.
        const namespace = normalizeNs(word);
        if (!clause.entries.some((entry) => entry.ns === namespace)) {
            return null;
        }
        const location = namespaceLocationFor(index, namespace);
        const start = location ? toVscodePosition(location) : undefined;
        if (!location || !start) {
            return null;
        }
        const end = toVscodePosition({ line: location.endLine, col: location.endCol });
        return new vscode.Location(
            // The daemon indexes resolved paths; a location spelled that way
            // opens a second copy of a file the editor may already have open.
            uriFromCli(location.uri, folderForUri(document.uri)),
            new vscode.Range(
                new vscode.Position(start.line, start.character),
                new vscode.Position(end?.line ?? start.line, end?.character ?? start.character)
            )
        );
    }

    /** What the daemon's namespace-aware index says the symbol resolves to. */
    private async fromDaemon(
        document: vscode.TextDocument,
        src: string,
        word: string
    ): Promise<vscode.Location | null> {
        const nsForm = parseNsForm(src);
        // A `:refer`'d name belongs to the namespace it was referred from, not
        // to this one; that is the whole point of asking a namespace-aware
        // index rather than searching by name.
        const referred = nsForm?.requireClause?.entries.find((entry) =>
            entry.refer.includes(word)
        )?.ns;
        const key = daemonSymbolKey(word, referred ?? nsForm?.name ?? '', aliasMapFromSource(src));
        if (!key) {
            return null;
        }
        const definition = await this.indexer.resolveSymbol(
            document.uri,
            key.namespace,
            key.symbol
        );
        const location = definitionLocation(definition);
        return location
            ? new vscode.Location(
                  uriFromCli(location.uri, folderForUri(document.uri)),
                  new vscode.Position(location.line, location.character)
              )
            : null;
    }

    private fromWorkspaceIndex(
        document: vscode.TextDocument,
        src: string,
        word: string
    ): vscode.Location | null {
        const doc = lookupSymbol(word, mergedDocs(this.indexer), aliasMapFromSource(src));
        // Workspace docs carry sourceFile + line / column; the bundled core
        // corpus has no file on this machine to jump to.
        if (!doc || !('sourceFile' in doc) || typeof doc.line !== 'number') {
            return null;
        }
        return new vscode.Location(
            vscode.Uri.file(doc.sourceFile as string),
            new vscode.Position(doc.line ?? 0, doc.column ?? 0)
        );
    }
}
