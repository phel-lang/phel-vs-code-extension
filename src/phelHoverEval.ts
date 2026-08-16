// Which token may be evaluated on hover.
//
// Hover fires from the mouse, so whatever we send to the live runtime runs
// without anyone asking for it. That rules out evaluating the enclosing *form*
// — pointing at `(delete-everything!)` would call it — and leaves plain
// symbols, whose evaluation is a var deref: `str/join` hands back the function,
// `*ns*` its value, and neither has an effect.
//
// Rejected on top of that:
//   locals            the runtime has no binding for them; only the current
//                     stack frame does, and hover is not in one
//   keywords          `:foo` evaluates to itself — the text you already see
//   numbers, strings  likewise, and strings are not symbols anyway
//   nil / true / false the same, one word further
//   special forms     they live in the compiler, not as vars
//   `php/…` names     interop, not vars: evaluating one bare is a compile error
//
// Kept free of `vscode` so the decision is unit-testable on its own.

import { SPECIAL_FORMS } from './phelCoreSymbols';
import { resolveLocalAt } from './phelScope';
import { PHEL_SYMBOL_RE } from './phelSymbolToken';

const SPECIAL = new Set(SPECIAL_FORMS);
const LITERALS = new Set(['nil', 'true', 'false']);

/**
 * The symbol at `offset` when evaluating it on hover is safe and worthwhile,
 * else null.
 */
export function hoverEvalCandidate(src: string, offset: number): string | null {
    const token = tokenAt(src, offset);
    if (!token) {
        return null;
    }
    if (token.startsWith(':') || LITERALS.has(token) || isNumber(token)) {
        return null;
    }
    if (SPECIAL.has(token) || token.startsWith('php/')) {
        return null;
    }
    return resolveLocalAt(src, offset) ? null : token;
}

/**
 * The Phel symbol token covering `offset`, skipping strings and line comments.
 * Same token shape the providers use for word ranges, so the hover text and
 * what gets evaluated cannot disagree.
 */
function tokenAt(src: string, offset: number): string | null {
    const symbol = new RegExp(PHEL_SYMBOL_RE.source, 'y');
    let i = 0;
    while (i < src.length) {
        if (i > offset) {
            return null; // scanned past it without finding a token
        }
        const c = src[i];
        if (c === ';') {
            const newline = src.indexOf('\n', i);
            const end = newline === -1 ? src.length : newline;
            if (offset < end) {
                return null; // inside a comment
            }
            i = end + 1;
            continue;
        }
        if (c === '"') {
            const end = endOfString(src, i);
            if (offset < end) {
                return null; // inside a string literal
            }
            i = end;
            continue;
        }
        symbol.lastIndex = i;
        const match = symbol.exec(src);
        if (!match) {
            i++; // a delimiter, or a reader macro character
            continue;
        }
        const end = i + match[0].length;
        if (offset < end) {
            return match[0];
        }
        i = end;
    }
    return null;
}

/** Offset one past the closing quote of the string starting at `start`. */
function endOfString(src: string, start: number): number {
    for (let i = start + 1; i < src.length; i++) {
        if (src[i] === '\\') {
            i++;
            continue;
        }
        if (src[i] === '"') {
            return i + 1;
        }
    }
    return src.length; // unterminated: the rest of the buffer is string
}

/** `42`, `-1`, `1.5`, `0x1f`, `.5` — but not the functions `+`, `-`, `.`. */
function isNumber(token: string): boolean {
    return /^[+-]?\.?\d/.test(token);
}
