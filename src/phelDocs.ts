// Parser for the structured documentation embedded in phel-lang source files.
//
// Each public form looks like:
//
//     (defn name
//       "Docstring."
//       {:example "(name 1) ; => 2"
//        :see-also ["other"]}
//       [args]
//       body)
//
// Any of docstring / meta-map / args may be absent (some forms use defn
// without a docstring; some bootstrap forms in core/defs.phel use bare `(def
// name ...)` to install macros). The parser is intentionally liberal: it
// pulls what it can find and falls back to leaving fields undefined rather
// than throwing.

export type PhelDocKind = 'fn' | 'macro' | 'def';

export interface PhelDoc {
    /** Bare name as it appears in source, e.g. `assoc`, `defn-`, `*ns*`. */
    name: string;
    /** Phel namespace, e.g. `phel.core`. */
    ns: string;
    /** `<ns>/<name>`. */
    qualifiedName: string;
    /** What kind of form introduced this binding. */
    kind: PhelDocKind;
    /**
     * The operator that introduced it, e.g. `defn`, `defrecord`, `deftest`.
     * Finer-grained than `kind`, which the symbol corpus keeps to three values;
     * used for outline icons. Absent on corpus entries generated before this
     * field existed.
     */
    form?: string;
    /** Whether the form is private (`defn-`, `defmacro-`, `def-`). */
    private: boolean;
    /** First arity signature, e.g. `(assoc m k v)`; undefined for plain `def`. */
    signature?: string;
    /** All arity signatures when the form has more than one. */
    arities?: string[];
    /** Docstring (the string literal directly after the name), if any. */
    doc?: string;
    /** `:example` value pulled from the meta-map, if any. */
    example?: string;
    /** `:see-also` values pulled from the meta-map, if any. */
    seeAlso?: string[];
    /**
     * `:deprecated` from the meta-map, as text: a version (`"1.4.0"`), a
     * reason, or `"true"` for a bare `true`. Absent when not deprecated.
     */
    deprecated?: string;
    /** `:superseded-by` from the meta-map: the replacement's name. */
    supersededBy?: string;
    /** GitHub blob URL pointing at the file the form lives in. */
    sourceUrl?: string;
    /** 0-based line number where the form starts (when known). */
    line?: number;
    /** 0-based column where the form starts (when known). */
    column?: number;
}

export interface ParseOptions {
    /**
     * Optional GitHub blob base URL the caller wants to attach to source
     * locations. The parser does not currently emit lines/files; callers can
     * combine this with a file path to build a `View source` link themselves.
     */
    sourceUrlBase?: string;
}

/**
 * Walks a Phel source string and returns a record for every `defn` /
 * `defn-` / `defmacro` / `defmacro-` / `def` / `def-` top-level form found.
 */
export function parsePhelFile(source: string, ns: string): PhelDoc[] {
    const docs: PhelDoc[] = [];
    const len = source.length;

    let i = 0;
    while (i < len) {
        // Skip whitespace and comments.
        i = skipTrivia(source, i);
        if (i >= len) {
            break;
        }

        if (source[i] !== '(') {
            // Not a form start; advance past this character.
            i++;
            continue;
        }

        const formStart = i;
        const formEnd = findMatchingParen(source, i);
        if (formEnd < 0) {
            break;
        }

        const opSlice = peekFirstSymbol(source, formStart + 1);
        if (opSlice && isDefiningOp(opSlice.value)) {
            const doc = parseDefiningForm(source, formStart, formEnd, opSlice, ns);
            if (doc) {
                const pos = positionAt(source, formStart);
                doc.line = pos.line;
                doc.column = pos.column;
                docs.push(doc);
            }
        }

        i = formEnd + 1;
    }

    return docs;
}

/**
 * Every top-level form that introduces a name.
 *
 * `kind` stays the three-way split the symbol corpus records; `form` keeps the
 * operator that introduced the name so the outline can pick a precise icon
 * without widening `PhelDocKind` (which `MACROS` / `CORE_FNS` filter on).
 *
 * The struct-like forms are `fn` rather than `def` because each one defines a
 * positional constructor, and their field vector is that constructor's
 * signature — exactly what the signature scan already extracts.
 *
 * `declare` is deliberately absent: it forward-declares names that a real
 * defining form supplies later in the same file, so indexing it would double
 * every declared symbol in the outline and the workspace picker.
 */
const DEFINING_OPS: Record<string, { kind: PhelDocKind; private: boolean }> = {
    defn: { kind: 'fn', private: false },
    'defn-': { kind: 'fn', private: true },
    defmacro: { kind: 'macro', private: false },
    'defmacro-': { kind: 'macro', private: true },
    def: { kind: 'def', private: false },
    'def-': { kind: 'def', private: true },
    defonce: { kind: 'def', private: false },
    defstruct: { kind: 'fn', private: false },
    defrecord: { kind: 'fn', private: false },
    deftype: { kind: 'fn', private: false },
    defmulti: { kind: 'fn', private: false },
    deftest: { kind: 'fn', private: false },
    defprotocol: { kind: 'def', private: false },
    definterface: { kind: 'def', private: false },
    defenum: { kind: 'def', private: false },
    defexception: { kind: 'def', private: false },
};

/**
 * Convert a byte offset into a {line, column} pair (both 0-based).
 */
export function positionAt(source: string, offset: number): { line: number; column: number } {
    const before = source.slice(0, offset);
    const lastNewline = before.lastIndexOf('\n');
    const line = (before.match(/\n/g) ?? []).length;
    const column = lastNewline < 0 ? offset : offset - lastNewline - 1;
    return { line, column };
}

function isDefiningOp(symbol: string): boolean {
    return Object.prototype.hasOwnProperty.call(DEFINING_OPS, symbol);
}

interface SymbolSlice {
    value: string;
    end: number;
}

function parseDefiningForm(
    source: string,
    formStart: number,
    formEnd: number,
    op: SymbolSlice,
    ns: string
): PhelDoc | null {
    const meta = DEFINING_OPS[op.value];
    let pos = skipTrivia(source, op.end);
    pos = skipMetadata(source, pos, formEnd);
    const nameSlice = peekFirstSymbol(source, pos);
    if (!nameSlice) {
        return null;
    }

    const doc: PhelDoc = {
        name: nameSlice.value,
        ns,
        qualifiedName: `${ns}/${nameSlice.value}`,
        kind: meta.kind,
        form: op.value,
        private: meta.private,
    };

    pos = skipTrivia(source, nameSlice.end);

    // Optional docstring.
    if (pos < formEnd && source[pos] === '"') {
        const stringEnd = findStringEnd(source, pos);
        if (stringEnd > pos) {
            doc.doc = decodePhelString(source.slice(pos + 1, stringEnd));
            pos = skipTrivia(source, stringEnd + 1);
        }
    }

    // Optional meta-map.
    if (pos < formEnd && source[pos] === '{') {
        const mapEnd = findMatchingBrace(source, pos);
        if (mapEnd > pos) {
            const mapBody = source.slice(pos + 1, mapEnd);
            const example = extractMetaValue(mapBody, ':example');
            if (example) {
                doc.example = example;
            }
            const seeAlso = extractSeeAlso(mapBody);
            if (seeAlso.length > 0) {
                doc.seeAlso = seeAlso;
            }
            const deprecated = extractDeprecated(mapBody);
            if (deprecated !== undefined) {
                doc.deprecated = deprecated;
                const supersededBy = extractMetaValue(mapBody, ':superseded-by');
                if (supersededBy) {
                    doc.supersededBy = supersededBy;
                }
            }
            pos = skipTrivia(source, mapEnd + 1);
        }
    }

    // Optional args vector(s) -> signature(s). Plain `def` rarely has one;
    // `defn` / `defmacro` always do (single or multi-arity).
    if (meta.kind !== 'def') {
        const arities = collectArities(source, pos, formEnd, doc.name);
        if (arities.length === 1) {
            doc.signature = arities[0];
        } else if (arities.length > 1) {
            doc.signature = arities[0];
            doc.arities = arities;
        }
    }

    return doc;
}

function collectArities(source: string, start: number, end: number, name: string): string[] {
    const arities: string[] = [];
    let pos = skipTrivia(source, start);

    if (pos < end && source[pos] === '[') {
        // Single arity.
        const close = findMatchingBracket(source, pos);
        if (close > pos) {
            arities.push(formatSignature(name, source.slice(pos + 1, close)));
        }
        return arities;
    }

    // Multi-arity: zero or more `([params] body)` lists.
    while (pos < end) {
        if (source[pos] !== '(') {
            break;
        }
        const close = findMatchingParen(source, pos);
        if (close < 0) {
            break;
        }
        const inner = skipTrivia(source, pos + 1);
        if (inner < close && source[inner] === '[') {
            const argsClose = findMatchingBracket(source, inner);
            if (argsClose > inner && argsClose < close) {
                arities.push(formatSignature(name, source.slice(inner + 1, argsClose)));
            }
        }
        pos = skipTrivia(source, close + 1);
    }

    return arities;
}

function formatSignature(name: string, argsBody: string): string {
    const collapsed = argsBody.replace(/\s+/g, ' ').trim();
    return collapsed.length === 0 ? `(${name})` : `(${name} ${collapsed})`;
}

function extractMetaValue(map: string, key: string): string | undefined {
    const idx = map.indexOf(key);
    if (idx < 0) {
        return undefined;
    }
    const pos = skipTrivia(map, idx + key.length);
    if (pos >= map.length || map[pos] !== '"') {
        return undefined;
    }
    const end = findStringEnd(map, pos);
    if (end <= pos) {
        return undefined;
    }
    return decodePhelString(map.slice(pos + 1, end));
}

/**
 * `:deprecated` accepts a version string, any other string as the reason, or
 * `true`; `false` and a missing key both mean "not deprecated". Returned as
 * text so a caller can tell the three apart the way the compiler does.
 */
function extractDeprecated(map: string): string | undefined {
    const key = ':deprecated';
    const idx = map.indexOf(key);
    if (idx < 0 || /[\w-]/.test(map[idx + key.length] ?? '')) {
        return undefined; // absent, or a longer key such as `:deprecated-since`
    }
    const pos = skipTrivia(map, idx + key.length);
    if (pos < map.length && map[pos] === '"') {
        return extractMetaValue(map, key);
    }
    return map.startsWith('true', pos) && !/[\w-]/.test(map[pos + 4] ?? '') ? 'true' : undefined;
}

function extractSeeAlso(map: string): string[] {
    const key = ':see-also';
    const idx = map.indexOf(key);
    if (idx < 0) {
        return [];
    }
    const pos = skipTrivia(map, idx + key.length);
    if (pos >= map.length || map[pos] !== '[') {
        return [];
    }
    const close = findMatchingBracket(map, pos);
    if (close <= pos) {
        return [];
    }
    const body = map.slice(pos + 1, close);
    const refs: string[] = [];
    let i = 0;
    while (i < body.length) {
        if (body[i] === '"') {
            const end = findStringEnd(body, i);
            if (end <= i) {
                break;
            }
            refs.push(decodePhelString(body.slice(i + 1, end)));
            i = end + 1;
        } else {
            i++;
        }
    }
    return refs;
}

// ----- low-level scanners ---------------------------------------------------

function skipTrivia(source: string, i: number): number {
    while (i < source.length) {
        const c = source[i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',') {
            i++;
            continue;
        }
        if (c === ';') {
            while (i < source.length && source[i] !== '\n') {
                i++;
            }
            continue;
        }
        if (c === '#' && source[i + 1] === '|') {
            i += 2;
            while (i < source.length - 1 && !(source[i] === '|' && source[i + 1] === '#')) {
                i++;
            }
            i += 2;
            continue;
        }
        if (c === '#' && source[i + 1] === '_') {
            // Skip the next form entirely.
            i = skipTrivia(source, i + 2);
            const formEnd = formEndAt(source, i);
            i = formEnd > i ? formEnd : i + 1;
            continue;
        }
        break;
    }
    return i;
}

function skipMetadata(source: string, start: number, end: number): number {
    let i = start;
    while (i < end && source[i] === '^') {
        // Each `^` is followed by exactly one form (the metadata payload).
        i = skipTrivia(source, i + 1);
        const after = formEndAt(source, i);
        i = skipTrivia(source, after > i ? after : i + 1);
    }
    return i;
}

function formEndAt(source: string, i: number): number {
    if (i >= source.length) {
        return i;
    }
    const c = source[i];
    if (c === '(') {
        return findMatchingParen(source, i) + 1;
    }
    if (c === '[') {
        return findMatchingBracket(source, i) + 1;
    }
    if (c === '{') {
        return findMatchingBrace(source, i) + 1;
    }
    if (c === '"') {
        return findStringEnd(source, i) + 1;
    }
    return readSymbolEnd(source, i);
}

function peekFirstSymbol(source: string, start: number): SymbolSlice | null {
    const i = skipTrivia(source, start);
    if (i >= source.length) {
        return null;
    }
    const end = readSymbolEnd(source, i);
    if (end === i) {
        return null;
    }
    return { value: source.slice(i, end), end };
}

function readSymbolEnd(source: string, i: number): number {
    while (i < source.length) {
        const c = source[i];
        if (
            c === ' ' ||
            c === '\t' ||
            c === '\n' ||
            c === '\r' ||
            c === ',' ||
            c === '(' ||
            c === ')' ||
            c === '[' ||
            c === ']' ||
            c === '{' ||
            c === '}' ||
            c === '"' ||
            c === ';'
        ) {
            break;
        }
        i++;
    }
    return i;
}

function findMatchingParen(source: string, openIdx: number): number {
    return findMatchingBracketLike(source, openIdx, '(', ')');
}

function findMatchingBracket(source: string, openIdx: number): number {
    return findMatchingBracketLike(source, openIdx, '[', ']');
}

function findMatchingBrace(source: string, openIdx: number): number {
    return findMatchingBracketLike(source, openIdx, '{', '}');
}

function findMatchingBracketLike(
    source: string,
    openIdx: number,
    open: string,
    close: string
): number {
    let depth = 0;
    let i = openIdx;
    while (i < source.length) {
        const c = source[i];
        if (c === '"') {
            i = findStringEnd(source, i) + 1;
            continue;
        }
        if (c === ';') {
            while (i < source.length && source[i] !== '\n') {
                i++;
            }
            continue;
        }
        if (c === '#' && source[i + 1] === '|') {
            i += 2;
            while (i < source.length - 1 && !(source[i] === '|' && source[i + 1] === '#')) {
                i++;
            }
            i += 2;
            continue;
        }
        if (c === open) {
            depth++;
        } else if (c === close) {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
        i++;
    }
    return -1;
}

function findStringEnd(source: string, openIdx: number): number {
    let i = openIdx + 1;
    while (i < source.length) {
        const c = source[i];
        if (c === '\\') {
            i += 2;
            continue;
        }
        if (c === '"') {
            return i;
        }
        i++;
    }
    return -1;
}

function decodePhelString(raw: string): string {
    return raw.replace(/\\(.)/g, (_, ch) => {
        switch (ch) {
            case 'n':
                return '\n';
            case 't':
                return '\t';
            case 'r':
                return '\r';
            case '"':
                return '"';
            case '\\':
                return '\\';
            default:
                return ch;
        }
    });
}
