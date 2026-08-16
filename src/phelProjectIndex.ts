// The project index `phel api-daemon` builds, and the mapping from what it
// answers to what the editor needs.
//
// `indexProject {srcDirs}` walks the project once and caches one index per
// daemon process; `resolveSymbol {namespace, symbol}` and
// `findReferences {namespace, symbol}` then answer from it. The JSON is the
// `ProjectIndex` / `Definition` / `Location` transfer objects verbatim, so two
// conventions come with it:
//
//   - lines and columns are **1-based**, and `0` means "unknown" (the reader
//     had no source location for that form). VS Code is 0-based throughout,
//     which is what `toVscodeLine` / `toVscodeCol` are for.
//   - namespaces are keyed in their canonical dotted spelling. A `phel\http`
//     written with the legacy separator finds nothing until it is converted,
//     which is what `normalizeNs` does everywhere else in the extension.
//
// What the index is *not* is a replacement for the TypeScript workspace index:
// the PHP extractor only knows `def`, `defn`, `defmacro`, `defstruct`,
// `definterface`, `defprotocol` and `defexception`, so it sees fewer
// definitions than `phelDocs.ts` does. Its value is the three things the TS
// side cannot compute: where a namespace is declared, which definition a name
// resolves to *within a namespace*, and references written with a namespace
// prefix (`s/includes?`), which a token scanner cannot recognise.
//
// Kept free of `vscode` imports so the mapping is unit-testable.

import { normalizeNs } from './phelNsAnalyzer';

/** A `Location`: a source position, 1-based, `0` meaning unknown. */
export interface PhelIndexLocation {
    /** Absolute path of the file, as the daemon read it off disk. */
    uri: string;
    line: number;
    col: number;
    /** `0` for references; the daemon only spans the `ns` declarations. */
    endLine: number;
    endCol: number;
}

/** A `Definition`: one top-level defining form the extractor recognised. */
export interface PhelIndexDefinition {
    /** Canonical dotted namespace, `''` for a file without an `ns` form. */
    namespace: string;
    name: string;
    uri: string;
    line: number;
    col: number;
    /** `defn`, `def`, `defmacro`, `defstruct`, … */
    kind: string;
    /** One entry per arity, each rendered as `[a b]`. */
    signature: string[];
    docstring: string;
    private: boolean;
    /** The `:deprecated` reason, `''` when the definition is not deprecated. */
    deprecated: string;
}

/** What `indexProject` answers with. */
export interface PhelProjectIndex {
    /** Counts the daemon computes for itself; kept so the shape round-trips. */
    namespaces: number;
    definitions: number;
    /** Definitions keyed by `namespace/name`. */
    symbols: Record<string, PhelIndexDefinition>;
    /** Reference sites keyed by `namespace/name`, as each file spells it. */
    references: Record<string, PhelIndexLocation[]>;
    /** `ns` declaration sites, keyed by canonical dotted namespace. */
    namespaceLocations: Record<string, PhelIndexLocation>;
}

/** A 0-based editor position, as VS Code counts them. */
export interface PhelIndexPosition {
    line: number;
    character: number;
}

/** A reference site, keyed by whatever file spelling the caller compares on. */
export interface PhelReferencePosition {
    file: string;
    line: number;
    character: number;
}

/** 1-based line to a 0-based one; `undefined` when the daemon said "unknown". */
export function toVscodeLine(line: unknown): number | undefined {
    return positive(line) ? line - 1 : undefined;
}

/** 1-based column to a 0-based one; `undefined` when the daemon said "unknown". */
export function toVscodeCol(col: unknown): number | undefined {
    return positive(col) ? col - 1 : undefined;
}

/**
 * Editor position of `location`. A known line with an unknown column lands at
 * the start of the line, which is where a jump with no column belongs; an
 * unknown line has no position at all.
 */
export function toVscodePosition(location: {
    line: number;
    col: number;
}): PhelIndexPosition | undefined {
    const line = toVscodeLine(location.line);
    return line === undefined ? undefined : { line, character: toVscodeCol(location.col) ?? 0 };
}

/** Where `definition` was written, or `undefined` when it cannot be located. */
export function definitionLocation(
    definition: PhelIndexDefinition | undefined
): (PhelIndexPosition & { uri: string }) | undefined {
    if (!definition || !definition.uri) {
        return undefined;
    }
    const position = toVscodePosition(definition);
    return position ? { uri: definition.uri, ...position } : undefined;
}

/**
 * The `ns` declaration site of `namespace`. Namespaces reach here in either
 * spelling — `phel\http` is what Phel's own sources write, `phel.http` is what
 * the index is keyed by — so canonicalise before the lookup.
 */
export function namespaceLocationFor(
    index: PhelProjectIndex,
    namespace: string
): PhelIndexLocation | undefined {
    return index.namespaceLocations[normalizeNs(namespace)];
}

/**
 * Split the symbol under the cursor into the `{namespace, symbol}` pair the
 * index is keyed by: `alias/name` resolves the alias through the file's
 * `:require` entries, and a bare name is anchored to the file's own namespace,
 * which is how the daemon distinguishes two definitions of the same name.
 *
 * `undefined` for a token that cannot name a definition (`str/`, `/join`).
 */
export function daemonSymbolKey(
    word: string,
    fileNamespace: string,
    aliases: ReadonlyMap<string, string>
): { namespace: string; symbol: string } | undefined {
    if (!word) {
        return undefined;
    }
    const slash = word.indexOf('/');
    if (slash < 0) {
        return { namespace: fileNamespace, symbol: word };
    }
    const prefix = word.slice(0, slash);
    const name = word.slice(slash + 1);
    if (!prefix || !name) {
        return undefined;
    }
    // An unaliased prefix is already the namespace (`phel.html/escape-html`).
    return { namespace: aliases.get(prefix) ?? prefix, symbol: name };
}

/**
 * Union the daemon's reference sites with the ones read from the workspace,
 * keeping one entry per position.
 *
 * The daemon read the files off disk, so its answer for a document with
 * unsaved changes is one edit behind: every hit it reports in a dirty file is
 * dropped in favour of what that buffer says now. Everything the workspace
 * side found is kept as it is — it carries the real token ranges, and the
 * daemon's own hits are positions only.
 */
export function mergeReferences<T extends PhelReferencePosition>(
    fromDaemon: readonly T[],
    fromWorkspace: readonly T[],
    dirtyFiles: ReadonlySet<string>
): T[] {
    const out = [...fromWorkspace];
    const seen = new Set(out.map(positionKey));
    for (const hit of fromDaemon) {
        if (dirtyFiles.has(hit.file) || seen.has(positionKey(hit))) {
            continue;
        }
        seen.add(positionKey(hit));
        out.push(hit);
    }
    return out;
}

/**
 * Read a daemon answer as a project index. `undefined` for anything that is
 * not one — an older daemon, an error the transport already turned into a
 * result, a method that answered `null`.
 */
export function toProjectIndex(result: unknown): PhelProjectIndex | undefined {
    const record = asRecord(result);
    if (!record) {
        return undefined;
    }
    const symbols = asRecord(record.symbols);
    if (!symbols) {
        return undefined;
    }
    const definitions: Record<string, PhelIndexDefinition> = {};
    for (const [key, value] of Object.entries(symbols)) {
        const definition = toDefinition(value);
        if (definition) {
            definitions[key] = definition;
        }
    }
    const references: Record<string, PhelIndexLocation[]> = {};
    for (const [key, value] of Object.entries(asRecord(record.references) ?? {})) {
        references[key] = toLocations(value);
    }
    const namespaceLocations: Record<string, PhelIndexLocation> = {};
    for (const [key, value] of Object.entries(asRecord(record.namespaceLocations) ?? {})) {
        const location = toLocation(value);
        if (location) {
            namespaceLocations[key] = location;
        }
    }
    return {
        namespaces: numberValue(record.namespaces),
        definitions: numberValue(record.definitions),
        symbols: definitions,
        references,
        namespaceLocations,
    };
}

/** Read a daemon answer as a definition; `undefined` when it found none. */
export function toDefinition(result: unknown): PhelIndexDefinition | undefined {
    const record = asRecord(result);
    if (!record || typeof record.name !== 'string' || record.name === '') {
        return undefined;
    }
    return {
        namespace: stringValue(record.namespace),
        name: record.name,
        uri: stringValue(record.uri),
        line: numberValue(record.line),
        col: numberValue(record.col),
        kind: stringValue(record.kind),
        signature: Array.isArray(record.signature)
            ? record.signature.filter((entry): entry is string => typeof entry === 'string')
            : [],
        docstring: stringValue(record.docstring),
        private: record.private === true,
        deprecated: stringValue(record.deprecated),
    };
}

/** Read a daemon answer as a list of locations; `[]` when it is not one. */
export function toLocations(result: unknown): PhelIndexLocation[] {
    if (!Array.isArray(result)) {
        return [];
    }
    const out: PhelIndexLocation[] = [];
    for (const entry of result) {
        const location = toLocation(entry);
        if (location) {
            out.push(location);
        }
    }
    return out;
}

function toLocation(value: unknown): PhelIndexLocation | undefined {
    const record = asRecord(value);
    if (!record || typeof record.uri !== 'string' || record.uri === '') {
        return undefined;
    }
    return {
        uri: record.uri,
        line: numberValue(record.line),
        col: numberValue(record.col),
        endLine: numberValue(record.endLine),
        endCol: numberValue(record.endCol),
    };
}

function positionKey(hit: PhelReferencePosition): string {
    return `${hit.file}|${hit.line}|${hit.character}`;
}

function positive(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function numberValue(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
}
