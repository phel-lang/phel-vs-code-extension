// Pure helper for selection-expansion. Given a source string and the current
// selection [start, end], returns the next-larger form span. The provider
// keeps a per-document stack and pops it for shrink.

import { parseAll, pathAt, type Form } from './phelParedit';

export interface Span {
    start: number;
    end: number;
}

export function expandSelection(src: string, start: number, end: number): Span | null {
    const forms = parseAll(src);
    const mid = Math.floor((start + end) / 2);
    const path = pathAt(forms, mid);
    const fromPath = pickEnclosing(path, start, end);
    if (fromPath) {
        return fromPath;
    }
    return pickEnclosing(forms, start, end);
}

function pickEnclosing(forms: readonly Form[], start: number, end: number): Span | null {
    for (let i = forms.length - 1; i >= 0; i--) {
        const f = forms[i];
        if (f.start <= start && end <= f.end && (f.start < start || f.end > end)) {
            return { start: f.start, end: f.end };
        }
    }
    return null;
}
