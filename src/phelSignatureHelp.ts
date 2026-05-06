// Pure helpers for the signature-help provider:
//
//   * `findCurrentCall(source, offset)` walks the text up to the cursor and
//     returns the callee + index of the parameter the cursor is pointing at,
//     or null if the cursor is not inside a `(callee ...)` form.
//
//   * `parseSignatureParams(signature)` turns `(name p1 p2 & rest)` into the
//     parameter labels VS Code expects (`['p1', 'p2', '& rest']`).
//
//   * `pickActiveSignature(arities, activeArg)` chooses which arity to
//     highlight when the form has more than one.
//
// Kept free of `vscode` imports so unit tests can exercise the logic without
// loading the editor host.

import type { PhelDoc } from './phelDocs';

export interface CurrentCall {
    /** Bare or qualified callee name as it appears in the source. */
    callee: string;
    /** Zero-based index of the parameter under the cursor. */
    activeArg: number;
}

interface Frame {
    kind: '(' | '[' | '{' | '"';
    callee?: string;
    /**
     * For `(` frames: -1 while we are still reading the callee token,
     * otherwise the count of completed arg tokens. For `[` / `{` frames the
     * count is unused.
     */
    argIndex: number;
    /** Whether the previous non-trivia char belonged to an arg token. */
    inArg: boolean;
}

const DELIMS = new Set(['(', ')', '[', ']', '{', '}', '"', ';', ' ', '\t', '\n', '\r', ',']);

/**
 * Walks `source` from index 0 up to (but not including) `offset`, returns
 * info about the innermost open `( ... )` form, or null if the cursor is at
 * the top level (or only inside vector / map / string contexts).
 */
export function findCurrentCall(source: string, offset: number): CurrentCall | null {
    const stack: Frame[] = [];
    const limit = Math.min(offset, source.length);

    let i = 0;
    while (i < limit) {
        const c = source[i];
        const top = stack[stack.length - 1];

        if (top?.kind === '"') {
            if (c === '\\') {
                i += 2;
                continue;
            }
            if (c === '"') {
                stack.pop();
                markArg(stack[stack.length - 1]);
                i++;
                continue;
            }
            i++;
            continue;
        }

        if (c === ';') {
            while (i < limit && source[i] !== '\n') {
                i++;
            }
            continue;
        }

        if (c === '#' && source[i + 1] === '|') {
            i += 2;
            while (i < limit - 1 && !(source[i] === '|' && source[i + 1] === '#')) {
                i++;
            }
            i += 2;
            continue;
        }

        if (c === '"') {
            stack.push({ kind: '"', argIndex: 0, inArg: false });
            i++;
            continue;
        }

        if (c === '(' || c === '[' || c === '{') {
            stack.push({
                kind: c,
                argIndex: c === '(' ? -1 : 0,
                inArg: false,
            });
            i++;
            continue;
        }

        if (c === ')' || c === ']' || c === '}') {
            stack.pop();
            markArg(stack[stack.length - 1]);
            i++;
            continue;
        }

        if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',') {
            if (top && top.inArg && top.argIndex >= 0) {
                top.argIndex++;
                top.inArg = false;
            }
            i++;
            continue;
        }

        // Symbol / number / keyword char.
        if (top?.kind === '(' && top.argIndex < 0) {
            // Reading the callee token.
            let end = i;
            while (end < limit && !DELIMS.has(source[end])) {
                end++;
            }
            top.callee = source.slice(i, end);
            top.argIndex = 0;
            top.inArg = false;
            i = end;
            continue;
        }

        if (top) {
            top.inArg = true;
        }
        i++;
    }

    for (let k = stack.length - 1; k >= 0; k--) {
        const f = stack[k];
        if (f.kind === '(' && f.callee) {
            return { callee: f.callee, activeArg: f.argIndex < 0 ? 0 : f.argIndex };
        }
    }
    return null;
}

function markArg(frame: Frame | undefined): void {
    if (!frame) {
        return;
    }
    if (frame.kind === '(' || frame.kind === '[' || frame.kind === '{') {
        frame.inArg = true;
    }
}

/**
 * Turn `(name p1 p2 & rest)` into `['p1', 'p2', '& rest']`.
 * Returns an empty array when the body is empty or the input cannot be
 * parsed.
 */
export function parseSignatureParams(signature: string): string[] {
    const trimmed = signature.trim();
    if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) {
        return [];
    }
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) {
        return [];
    }
    const space = inner.indexOf(' ');
    if (space < 0) {
        return [];
    }
    const body = inner.slice(space + 1).trim();
    if (!body) {
        return [];
    }
    const tokens = body.split(/\s+/);
    const out: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] === '&' && tokens[i + 1]) {
            out.push(`& ${tokens[i + 1]}`);
            i++;
        } else {
            out.push(tokens[i]);
        }
    }
    return out;
}

/**
 * Whether a parameter list ends in a Clojure-style `& rest`.
 */
export function hasRest(params: readonly string[]): boolean {
    return params.length > 0 && params[params.length - 1].startsWith('&');
}

/**
 * Clamp `activeArg` to a valid index within `params`. When the parameter
 * list ends in `& rest`, any arg index past the rest position maps to the
 * rest parameter. Returns -1 if there are no parameters at all.
 */
export function clampActiveParam(params: readonly string[], activeArg: number): number {
    if (params.length === 0) {
        return -1;
    }
    if (activeArg <= 0) {
        return 0;
    }
    if (activeArg < params.length) {
        return activeArg;
    }
    return hasRest(params) ? params.length - 1 : params.length - 1;
}

/**
 * Pick which arity from a multi-arity definition best matches the active
 * argument index. Prefers an arity whose param count strictly contains
 * `activeArg`; falls back to the last arity (the one most likely to have a
 * rest parameter) when none fits.
 */
export function pickActiveSignature(arities: readonly string[], activeArg: number): number {
    if (arities.length === 0) {
        return 0;
    }
    for (let i = 0; i < arities.length; i++) {
        const params = parseSignatureParams(arities[i]);
        if (activeArg < params.length) {
            return i;
        }
        if (hasRest(params)) {
            return i;
        }
    }
    return arities.length - 1;
}

/**
 * Convenience: pick all the arities for a `PhelDoc`. Always returns at least
 * one signature when the doc is callable; returns an empty array for plain
 * `def` forms.
 */
export function aritiesOf(doc: PhelDoc): string[] {
    if (doc.arities && doc.arities.length > 0) {
        return [...doc.arities];
    }
    if (doc.signature) {
        return [doc.signature];
    }
    return [];
}
