// Build a `${1:arg}`-style snippet from a PhelDoc's first arity signature.
// The completion provider attaches the result to `item.insertText` only when
// the cursor sits in callee position (right after `(`).

import { parseSignatureParams } from './phelSignatureHelp';

export function buildCallSnippet(name: string, signature?: string): string | null {
    if (!signature) {
        return null;
    }
    const params = parseSignatureParams(signature);
    if (params.length === 0) {
        return null;
    }
    const tabs = params.map((p, i) => `\${${i + 1}:${p.replace(/[{}\\$]/g, '')}}`);
    return `${name} ${tabs.join(' ')}`;
}

/**
 * True when the character immediately before `offset` is an opening `(`,
 * meaning the user is starting a function call. Whitespace between `(` and
 * the cursor disqualifies (the user has moved past the callee slot).
 */
export function isCalleePosition(linePrefix: string): boolean {
    let i = linePrefix.length - 1;
    while (i >= 0 && /[A-Za-z0-9_!?*+<>=/\-.':$&%]/.test(linePrefix[i])) {
        i--;
    }
    if (i < 0) {
        return false;
    }
    return linePrefix[i] === '(';
}
