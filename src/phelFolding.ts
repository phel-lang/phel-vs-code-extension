// Pure folding-range computation for `.phel`: every multi-line collection form
// folds, as do runs of consecutive line comments. Line numbers are 0-based to
// match VS Code's `FoldingRange`. No `vscode` import, so it is unit-testable.

import { isContainer, type Form } from './phelParedit';
import { parseAllCached } from './phelParseCache';

export interface FoldRange {
    start: number;
    end: number;
    comment?: boolean;
}

function lineStarts(src: string): number[] {
    const starts = [0];
    for (let i = 0; i < src.length; i++) {
        if (src[i] === '\n') {
            starts.push(i + 1);
        }
    }
    return starts;
}

function lineOf(starts: readonly number[], offset: number): number {
    let lo = 0;
    let hi = starts.length - 1;
    let ans = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= offset) {
            ans = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return ans;
}

export function computeFoldRanges(src: string): FoldRange[] {
    const starts = lineStarts(src);
    const out: FoldRange[] = [];

    const walk = (f: Form): void => {
        if (isContainer(f)) {
            const startLine = lineOf(starts, f.start);
            const endLine = lineOf(starts, Math.max(f.start, f.bodyEnd - 1));
            if (endLine > startLine) {
                out.push({ start: startLine, end: endLine });
            }
        }
        for (const child of f.children) {
            walk(child);
        }
    };
    for (const f of parseAllCached(src)) {
        walk(f);
    }

    // Runs of two or more consecutive line-comment (`;`) lines fold together.
    const lines = src.split('\n');
    let runStart = -1;
    const flush = (endLine: number): void => {
        if (runStart >= 0 && endLine > runStart) {
            out.push({ start: runStart, end: endLine, comment: true });
        }
        runStart = -1;
    };
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*;/.test(lines[i])) {
            if (runStart < 0) {
                runStart = i;
            }
        } else {
            flush(i - 1);
        }
    }
    flush(lines.length - 1);

    return out;
}
