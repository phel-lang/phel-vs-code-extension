// Pure helper: extract candidate variable names from a Phel source range.
// Each occurrence becomes a separate InlineValue entry so the same name on
// multiple lines is annotated independently. Strings, comments, char
// literals, and reader keyword tokens (`:foo`) are skipped.

const KEYWORD_PREFIXES = new Set([':']);
const SYMBOL_BODY = /[A-Za-z0-9_!?*+<>=/\-.':$&%]/;
const SYMBOL_TERMINATOR = new Set([
    ' ',
    '\t',
    '\n',
    '\r',
    ',',
    '(',
    ')',
    '[',
    ']',
    '{',
    '}',
    '"',
    ';',
    "'",
    '`',
    '@',
    '~',
    '^',
]);

export interface InlineNameOccurrence {
    /** 0-based line. */
    line: number;
    /** 0-based column where the name starts. */
    column: number;
    /** Bare symbol token. */
    name: string;
}

export function findInlineCandidates(
    source: string,
    fromLine: number,
    toLine: number
): InlineNameOccurrence[] {
    const lines = source.split(/\r?\n/);
    const out: InlineNameOccurrence[] = [];
    const start = Math.max(0, fromLine);
    const end = Math.min(lines.length - 1, toLine);
    for (let line = start; line <= end; line++) {
        scanLine(lines[line], line, out);
    }
    return out;
}

function scanLine(text: string, line: number, out: InlineNameOccurrence[]): void {
    let i = 0;
    let inString = false;
    while (i < text.length) {
        const c = text[i];
        if (inString) {
            if (c === '\\') {
                i += 2;
                continue;
            }
            if (c === '"') {
                inString = false;
            }
            i++;
            continue;
        }
        if (c === ';') {
            return;
        }
        if (c === '"') {
            inString = true;
            i++;
            continue;
        }
        if (c === '\\') {
            i += 2;
            continue;
        }
        if (KEYWORD_PREFIXES.has(c)) {
            i++;
            while (
                i < text.length &&
                SYMBOL_BODY.test(text[i]) &&
                !SYMBOL_TERMINATOR.has(text[i])
            ) {
                i++;
            }
            continue;
        }
        if (isReaderPrefix(c)) {
            i++;
            continue;
        }
        if (!SYMBOL_BODY.test(c) || SYMBOL_TERMINATOR.has(c)) {
            i++;
            continue;
        }
        const start = i;
        while (i < text.length && SYMBOL_BODY.test(text[i]) && !SYMBOL_TERMINATOR.has(text[i])) {
            i++;
        }
        const name = text.slice(start, i);
        if (isCandidate(name)) {
            out.push({ line, column: start, name });
        }
    }
}

function isReaderPrefix(c: string): boolean {
    return c === "'" || c === '`' || c === '~' || c === '@' || c === '^' || c === '#';
}

function isCandidate(name: string): boolean {
    if (!name) {
        return false;
    }
    if (name.startsWith(':')) {
        return false;
    }
    if (/^[0-9]/.test(name)) {
        return false;
    }
    if (name === 'true' || name === 'false' || name === 'nil') {
        return false;
    }
    if (name.includes('/')) {
        return false;
    } // namespace-qualified
    if (!/^[A-Za-z_]/.test(name)) {
        return false;
    } // reject `+`, `-`, `*` etc.
    return true;
}
