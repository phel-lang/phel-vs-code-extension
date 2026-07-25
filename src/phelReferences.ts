// Pure occurrence scanner. Walks `src` and returns every position where
// `name` appears as a symbol token (i.e. surrounded by non-symbol delimiters
// and not inside a string, character literal, or comment).
//
// Used by the references provider, the rename provider, and (potentially)
// future refactorings. No `vscode` imports so the logic is unit-testable.

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

export interface Occurrence {
    start: number;
    end: number;
}

/**
 * Find every occurrence of `name` as a standalone symbol token in `src`.
 * Skips strings (`"..."`), char literals (`\c`), line comments (`;...`),
 * block comments (`#| ... |#`), and `#_`-discarded forms.
 */
export function findOccurrences(src: string, name: string): Occurrence[] {
    if (!name) {
        return [];
    }
    const out: Occurrence[] = [];
    const len = src.length;
    let i = 0;
    while (i < len) {
        const c = src[i];
        if (c === '"') {
            i = skipString(src, i, len);
            continue;
        }
        if (c === ';') {
            while (i < len && src[i] !== '\n') {
                i++;
            }
            continue;
        }
        if (c === '#' && src[i + 1] === '|') {
            i = skipBlockComment(src, i, len);
            continue;
        }
        if (c === '\\') {
            i = skipChar(src, i, len);
            continue;
        }
        if (matchesAt(src, i, name)) {
            const end = i + name.length;
            const before = i === 0 ? '' : src[i - 1];
            const after = end >= len ? '' : src[end];
            if (isBoundaryBefore(before) && isBoundaryAfter(after)) {
                out.push({ start: i, end });
                i = end;
                continue;
            }
        }
        i++;
    }
    return out;
}

function skipString(src: string, start: number, len: number): number {
    let i = start + 1;
    while (i < len) {
        const c = src[i];
        if (c === '\\') {
            i += 2;
            continue;
        }
        if (c === '"') {
            return i + 1;
        }
        i++;
    }
    return len;
}

function skipBlockComment(src: string, start: number, len: number): number {
    let i = start + 2;
    while (i < len - 1) {
        if (src[i] === '|' && src[i + 1] === '#') {
            return i + 2;
        }
        i++;
    }
    return len;
}

function skipChar(src: string, start: number, len: number): number {
    let i = start + 1;
    while (i < len && !SYMBOL_TERMINATOR.has(src[i])) {
        i++;
    }
    return i === start + 1 && i < len ? i + 1 : i;
}

function matchesAt(src: string, i: number, name: string): boolean {
    for (let k = 0; k < name.length; k++) {
        if (src[i + k] !== name[k]) {
            return false;
        }
    }
    return true;
}

/**
 * `'` is the one terminator that only works on the *left*. The lexer treats a
 * leading apostrophe as the quote reader macro but keeps a mid or trailing one
 * inside the atom, so `a'` and `foo''` are single symbols while `'sym` is a
 * quote followed by `sym`.
 *
 * Using the symmetric test for both sides made the `a` in `a'` look like a
 * whole token, so renaming `a` rewrote part of `a'`.
 */
function isBoundaryBefore(c: string): boolean {
    if (c === '') {
        return true;
    }
    return SYMBOL_TERMINATOR.has(c);
}

function isBoundaryAfter(c: string): boolean {
    if (c === '') {
        return true;
    }
    if (c === "'") {
        return false; // part of the symbol being scanned
    }
    return SYMBOL_TERMINATOR.has(c);
}

/**
 * Validate that `name` is a legal Phel symbol token (no whitespace, no
 * delimiter chars). Used by the rename provider before applying edits.
 *
 * A trailing `'` is legal — `a'` is a single symbol — but a leading one is the
 * quote reader macro, so it is rejected.
 */
export function isValidSymbolName(name: string): boolean {
    if (!name) {
        return false;
    }
    if (name.startsWith("'")) {
        return false;
    }
    for (const c of name) {
        if (c === "'") {
            continue;
        }
        if (SYMBOL_TERMINATOR.has(c)) {
            return false;
        }
    }
    return true;
}
