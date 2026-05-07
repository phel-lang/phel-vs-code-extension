// Pure helpers used by the REPL provider. No `vscode` imports so the cursor
// math can be unit tested without an editor host.

import { parseAll } from './phelParedit';

export interface FormSpan {
    start: number;
    end: number;
    text: string;
}

/**
 * Top-level form whose span contains `offset`. Returns null if the cursor
 * is between top-level forms (whitespace / comments).
 */
export function topLevelFormAt(src: string, offset: number): FormSpan | null {
    const forms = parseAll(src);
    for (const f of forms) {
        if (f.start <= offset && offset <= f.end) {
            return { start: f.start, end: f.end, text: src.slice(f.start, f.end) };
        }
    }
    return null;
}

/**
 * Top-level form whose span starts at or after `offset`. Used to step from
 * one form to the next when evaluating successive forms in a buffer.
 */
export function nextTopLevelFormAfter(src: string, offset: number): FormSpan | null {
    const forms = parseAll(src);
    for (const f of forms) {
        if (f.start >= offset) {
            return { start: f.start, end: f.end, text: src.slice(f.start, f.end) };
        }
    }
    return null;
}

/**
 * Collapse a multiline form into a single line so it can be pasted into
 * a line-oriented terminal REPL without intermediate continuation prompts.
 * Preserves single spaces and trims the trailing newline.
 */
export function flattenForTerminal(text: string): string {
    return text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}
