// Pure occurrence scanner. Walks `src` and returns every position where
// `name` appears as a symbol token (i.e. surrounded by non-symbol delimiters
// and not inside a string, character literal, or comment).
//
// Two kinds of scan over the same rules live here: one asks where a given name
// is (`findOccurrences`, and `findQualifiedOccurrences` /
// `findPrefixedOccurrences` for the two halves of a qualified token), the other
// reads every token once and tallies them (`countSymbolTokens`), which is what
// lets the reference CodeLens answer "how many" without rescanning the
// workspace per lens.
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

/** An `alias/name` occurrence, with the offsets a rename of `name` needs. */
export interface PrefixedOccurrence extends Occurrence {
    /** What is written before the `/`: an alias, or a namespace spelled out. */
    prefix: string;
    /** Offset where the `name` half starts. */
    nameStart: number;
}

/**
 * Find every occurrence of `name` as a standalone symbol token in `src`.
 * Skips strings (`"..."`), char literals (`\c`), line comments (`;...`),
 * block comments (`#| ... |#`), and `#_`-discarded forms.
 */
export function findOccurrences(src: string, name: string): Occurrence[] {
    return name ? scan(src, name, true) : [];
}

/**
 * Find every symbol *qualified by* `ns`, i.e. every token starting `ns/`. The
 * namespace part of `json/encode` is not a token of its own, so
 * `findOccurrences(src, 'json')` deliberately never matches it — which is what
 * a rename wants, and the opposite of what "is this alias used?" needs.
 *
 * The returned span covers the `ns/` prefix; nothing so far needs the name
 * after the slash. Same skipping rules as `findOccurrences`.
 */
export function findQualifiedOccurrences(src: string, ns: string): Occurrence[] {
    return ns ? scan(src, ns + '/', false) : [];
}

/**
 * Walk `src` outside strings / comments / char literals looking for `needle`.
 * `closed` says whether the needle is a whole token (so the character after it
 * has to end one) or only its head (so the character after it has to continue
 * one, since `ns/` alone is not a symbol).
 */
function scan(src: string, needle: string, closed: boolean): Occurrence[] {
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
        if (matchesAt(src, i, needle)) {
            const end = i + needle.length;
            const before = i === 0 ? '' : src[i - 1];
            const after = end >= len ? '' : src[end];
            const tail = closed ? isBoundaryAfter(after) : after !== '' && !isBoundaryAfter(after);
            if (isBoundaryBefore(before) && tail) {
                out.push({ start: i, end });
                i = end;
                continue;
            }
        }
        i++;
    }
    return out;
}

/**
 * Every symbol token in `src`, in source order, with the same strings /
 * character literals / comments skipped that `findOccurrences` skips.
 *
 * A token runs from one delimiter to the next, so unlike `findOccurrences` this
 * sees the *whole* of a qualified token (`s/shout`) rather than only the names
 * that happen to be delimited on both sides.
 */
function forEachSymbolToken(src: string, visit: (token: string, start: number) => void): void {
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
        if (SYMBOL_TERMINATOR.has(c)) {
            i++;
            continue;
        }
        const start = i;
        // `isBoundaryAfter` is what keeps `a'` one token: an apostrophe ends a
        // token on its left only.
        while (i < len && !isBoundaryAfter(src[i])) {
            i++;
        }
        visit(src.slice(start, i), start);
    }
}

/**
 * How often each symbol token is written in `src`, in one pass.
 *
 * A qualified token is counted twice: under the spelling it was written with
 * (`s/shout`) and under its bare name (`shout`). The second tally is the only
 * way an alias-qualified use gets counted at all — a scan for `shout` never
 * matches inside `s/shout`, so without it a function called only through an
 * alias would look like a function nobody calls.
 */
export function countSymbolTokens(src: string): Map<string, number> {
    const counts = new Map<string, number>();
    forEachSymbolToken(src, (token) => {
        bump(counts, token);
        const name = nameHalf(token);
        if (name) {
            bump(counts, name);
        }
    });
    return counts;
}

/**
 * Where each distinct symbol token is first written in `src`.
 *
 * The reference CodeLens uses it to anchor its click: the workspace index
 * records where a defining *form* starts, and the editor's reference peek needs
 * a position that sits on the symbol itself.
 */
export function firstSymbolTokenOffsets(src: string): Map<string, number> {
    const out = new Map<string, number>();
    forEachSymbolToken(src, (token, start) => {
        if (!out.has(token)) {
            out.set(token, start);
        }
    });
    return out;
}

/**
 * Every `prefix/name` occurrence in `src` for the given bare `name` — the other
 * half of `findQualifiedOccurrences`, which searches by the prefix instead. The
 * caller decides whether a prefix means the namespace it is after, since only
 * that file's `(:require …)` can say what an alias stands for.
 */
export function findPrefixedOccurrences(src: string, name: string): PrefixedOccurrence[] {
    const out: PrefixedOccurrence[] = [];
    if (!name) {
        return out;
    }
    forEachSymbolToken(src, (token, start) => {
        const slash = token.indexOf('/');
        if (slash <= 0 || token.slice(slash + 1) !== name) {
            return;
        }
        out.push({
            start,
            end: start + token.length,
            prefix: token.slice(0, slash),
            nameStart: start + slash + 1,
        });
    });
    return out;
}

/** The `name` of an `ns/name` token, or `''` when the token carries none. */
function nameHalf(token: string): string {
    const slash = token.indexOf('/');
    return slash > 0 ? token.slice(slash + 1) : '';
}

function bump(counts: Map<string, number>, name: string): void {
    counts.set(name, (counts.get(name) ?? 0) + 1);
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
