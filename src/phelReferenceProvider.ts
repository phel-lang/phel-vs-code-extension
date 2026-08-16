// Find-all-references for `.phel` symbols. Walks every indexed file plus the
// active document, looking for the symbol under the cursor (skipping strings /
// comments / char literals) in both spellings it can be written with: the bare
// name, and `alias/name` wherever that file's `(:require …)` makes the alias
// mean the namespace the symbol belongs to. A same-named symbol from another
// namespace is not a hit, which is what makes the qualified half safe to rename.
//
// When a daemon has indexed the project, its own reference sites are merged in.
// What the daemon cannot do is read an unsaved buffer, so its hits in a dirty
// file give way to what that buffer says now. What it reports is a *position*,
// not a span — the token there has to be read back out of the source, or a hit
// on `s/shout` would be spanned as the five characters `s/sho`.

import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { aliasMapFromSource, normalizeNs, parseNsForm } from './phelNsAnalyzer';
import {
    daemonSymbolKey,
    mergeReferences,
    type PhelIndexLocation,
    type PhelReferencePosition,
    toVscodePosition,
} from './phelProjectIndex';
import { findOccurrences, findPrefixedOccurrences } from './phelReferences';
import { resolveLocalAt, localOccurrences } from './phelScope';
import type { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';
import { PHEL_SYMBOL_RE, symbolTokenAt } from './phelSymbolToken';
import { folderForUri, uriFromCli } from './phelWorkspace';

/** One reference site, in the two spans a caller may need. */
export interface MergedReference {
    /** The whole token, which is what the editor highlights. */
    location: vscode.Location;
    /** Whether it is written with a namespace prefix (`s/shout`). */
    qualified: boolean;
    /** The `name` half of the token: the part a rename rewrites. */
    nameRange: vscode.Range;
}

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
        const references = await findMergedReferences(
            document.getText(range),
            document,
            this.indexer
        );
        return references.map((hit) => hit.location);
    }
}

/** A reference site, carrying what `mergeReferences` dedupes on. */
interface Hit extends PhelReferencePosition, MergedReference {}

/** A file the scan reads: its text, plus the open buffer when there is one. */
interface Source {
    uri: vscode.Uri;
    text: string;
    /** The open document, whose own position math is cheaper than ours. */
    doc?: vscode.TextDocument;
    /** Lazily split lines, for reading a token back out of a closed file. */
    lines?: string[];
}

/** What the search is for: a bare name, and the namespace it belongs to. */
interface ReferenceTarget {
    name: string;
    /** Canonical dotted namespace; `''` when nothing here could say. */
    namespace: string;
}

/**
 * Every reference to the symbol written as `word` in `document` — the token
 * scan over the workspace, merged with what the daemon's index holds.
 *
 * `word` is the token as written, so both `shout` and `s/shout` reach here; the
 * namespace it resolves to is what decides whether a qualified use somewhere
 * else is this symbol or a same-named one from another namespace.
 */
export async function findMergedReferences(
    word: string,
    document: vscode.TextDocument,
    indexer: PhelWorkspaceIndexer
): Promise<MergedReference[]> {
    const src = document.getText();
    // Asked first, awaited last: the daemon answers over a pipe while the file
    // reads below are in flight.
    const daemonLocations = indexer.findReferences(
        document.uri,
        parseNsForm(src)?.name ?? '',
        word
    );
    const target = referenceTarget(word, src);
    const sources = await referenceSources(document, indexer);
    const workspace: Hit[] = [];
    for (const source of sources) {
        collectFrom(source, target, workspace);
    }
    const daemon = resolveDaemonHits(await daemonLocations, word, document, sources);
    return mergeReferences(daemon, workspace, dirtyPhelFiles());
}

/**
 * The symbol `word` names, as seen from the file it is written in: an alias is
 * resolved through the `(:require …)` clause, a `:refer`'d name belongs to the
 * namespace it was referred from, and a bare name to this file's own namespace.
 */
function referenceTarget(word: string, src: string): ReferenceTarget {
    const nsForm = parseNsForm(src);
    const referred = nsForm?.requireClause?.entries.find((entry) => entry.refer.includes(word))?.ns;
    const key = daemonSymbolKey(word, referred ?? nsForm?.name ?? '', aliasMapFromSource(src));
    return key
        ? { name: key.symbol, namespace: normalizeNs(key.namespace) }
        : { name: word, namespace: '' };
}

/**
 * The active document plus every indexed file, each with its text. Every file
 * is read, not only the ones that define something: a file can use a name
 * without defining any of its own (a `defbench`, a script).
 */
async function referenceSources(
    activeDoc: vscode.TextDocument,
    indexer: PhelWorkspaceIndexer
): Promise<Source[]> {
    const out: Source[] = [{ uri: activeDoc.uri, text: activeDoc.getText(), doc: activeDoc }];
    const seen = new Set([activeDoc.uri.toString()]);

    for (const file of new Set(indexer.index.files())) {
        // Compare URIs, not `fsPath`: on Windows the same file can be spelled
        // with either drive-letter case, and only the URI form is normalised.
        const uri = vscode.Uri.file(file);
        const key = uri.toString();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        const opened = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
        if (opened) {
            out.push({ uri, text: opened.getText(), doc: opened });
            continue;
        }
        try {
            out.push({ uri, text: await fs.readFile(file, 'utf-8') });
        } catch {
            // File disappeared between indexing and the request.
        }
    }
    return out;
}

function collectFrom(source: Source, target: ReferenceTarget, out: Hit[]): void {
    for (const occ of findOccurrences(source.text, target.name)) {
        const range = rangeOf(source, occ.start, occ.end);
        out.push(hit(source.uri, range, range));
    }

    const qualified = findPrefixedOccurrences(source.text, target.name);
    // The alias map costs a parse of the file's `(ns …)` form, so it is only
    // built for a file that writes the name qualified at all. Without a
    // namespace to compare against there is nothing to decide, either.
    if (qualified.length === 0 || !target.namespace) {
        return;
    }
    const aliases = aliasMapFromSource(source.text);
    for (const occ of qualified) {
        if (normalizeNs(aliases.get(occ.prefix) ?? occ.prefix) !== target.namespace) {
            continue;
        }
        out.push(
            hit(
                source.uri,
                rangeOf(source, occ.start, occ.end),
                rangeOf(source, occ.nameStart, occ.end)
            )
        );
    }
}

/**
 * What the daemon's index holds for the token under the cursor, spelled as it
 * is written here: a qualified `alias/name` is the key the index uses, and a
 * bare name is anchored to this file's own namespace.
 */
function resolveDaemonHits(
    locations: readonly PhelIndexLocation[],
    word: string,
    document: vscode.TextDocument,
    sources: readonly Source[]
): Hit[] {
    if (locations.length === 0) {
        return [];
    }
    const folder = folderForUri(document.uri);
    const byUri = new Map(sources.map((source) => [source.uri.toString(), source]));
    const out: Hit[] = [];
    for (const location of locations) {
        const position = toVscodePosition(location);
        if (!position) {
            continue;
        }
        // The daemon indexes resolved paths; keyed that way a hit would neither
        // dedupe against the token scan's nor give way to a dirty buffer, and it
        // would point at a file the editor shows twice.
        const uri = uriFromCli(location.uri, folder);
        const line = lineAt(byUri.get(uri.toString()), position.line);
        // A file the index never saw leaves nothing to read the token from; the
        // searched-for token is as good a guess at its length as exists.
        const token = (line === undefined
            ? undefined
            : symbolTokenAt(line, position.character)) ?? {
            start: position.character,
            end: position.character + word.length,
        };
        const text = line?.slice(token.start, token.end) ?? word;
        const slash = text.indexOf('/');
        const qualified = slash > 0 && slash < text.length - 1;
        const end = new vscode.Position(position.line, token.end);
        out.push(
            hit(
                uri,
                new vscode.Range(new vscode.Position(position.line, token.start), end),
                new vscode.Range(
                    new vscode.Position(
                        position.line,
                        qualified ? token.start + slash + 1 : token.start
                    ),
                    end
                )
            )
        );
    }
    return out;
}

function hit(uri: vscode.Uri, range: vscode.Range, nameRange: vscode.Range): Hit {
    return {
        file: uri.toString(),
        line: range.start.line,
        character: range.start.character,
        location: new vscode.Location(uri, range),
        qualified: !range.isEqual(nameRange),
        nameRange,
    };
}

function rangeOf(source: Source, start: number, end: number): vscode.Range {
    return source.doc
        ? new vscode.Range(source.doc.positionAt(start), source.doc.positionAt(end))
        : new vscode.Range(positionAt(source.text, start), positionAt(source.text, end));
}

/** Text of one line of a source, or `undefined` when there is no such line. */
function lineAt(source: Source | undefined, line: number): string | undefined {
    if (!source) {
        return undefined;
    }
    if (source.doc) {
        return line < source.doc.lineCount ? source.doc.lineAt(line).text : undefined;
    }
    source.lines ??= source.text.split('\n');
    return source.lines[line]?.replace(/\r$/, '');
}

/** Open documents with unsaved changes, keyed the way `Hit.file` is. */
function dirtyPhelFiles(): Set<string> {
    return new Set(
        vscode.workspace.textDocuments
            .filter((doc) => doc.isDirty && doc.languageId === 'phel')
            .map((doc) => doc.uri.toString())
    );
}

function positionAt(text: string, offset: number): vscode.Position {
    const before = text.slice(0, offset);
    const lastNewline = before.lastIndexOf('\n');
    const line = (before.match(/\n/g) ?? []).length;
    const character = lastNewline < 0 ? offset : offset - lastNewline - 1;
    return new vscode.Position(line, character);
}
