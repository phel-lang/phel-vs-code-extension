// Pure structural refactorings over the `phelParedit` reader. Each takes source
// plus a cursor offset and returns a single text replacement (or null when the
// refactor does not apply at that position). No `vscode` imports, so the
// transforms are unit-testable in isolation from the code-action provider.

import { parseAll, pathAt, type Form } from './phelParedit';

export interface RefactorEdit {
    /** Replace `[start, end)` in the source with `text`. */
    start: number;
    end: number;
    text: string;
}

function text(src: string, f: Form): string {
    return src.slice(f.start, f.end);
}

function headName(src: string, f: Form): string | null {
    if (f.kind !== 'list' || f.children.length === 0) {
        return null;
    }
    const head = f.children[0];
    return head.kind === 'atom' ? text(src, head) : null;
}

/** Innermost enclosing list form at `offset`, or null. */
function enclosingList(src: string, offset: number): Form | null {
    const path = pathAt(parseAll(src), offset);
    for (let i = path.length - 1; i >= 0; i--) {
        if (path[i].kind === 'list') {
            return path[i];
        }
    }
    return null;
}

/** Innermost enclosing container (list / vector / map) at `offset`, or null. */
function enclosingContainer(src: string, offset: number): Form | null {
    const path = pathAt(parseAll(src), offset);
    for (let i = path.length - 1; i >= 0; i--) {
        const k = path[i].kind;
        if (k === 'list' || k === 'vector' || k === 'map') {
            return path[i];
        }
    }
    return null;
}

const ARROWS = new Set(['->', '->>']);

/**
 * Thread the call at `offset` into a `->` (first) or `->>` (last) pipeline,
 * fully unwinding the threaded-argument spine. `(map f (filter p xs))` becomes
 * `(->> xs (filter p) (map f))` with `last`, or a `->` chain otherwise.
 */
export function threadForm(src: string, offset: number, last: boolean): RefactorEdit | null {
    const target = enclosingList(src, offset);
    if (!target) {
        return null;
    }
    const startHead = headName(src, target);
    if (startHead === null || ARROWS.has(startHead)) {
        return null; // not a plain call, or already threaded
    }

    const arrow = last ? '->>' : '->';
    const steps: string[] = [];
    let cur: Form = target;
    for (;;) {
        if (cur.kind !== 'list' || cur.children.length < 2) {
            return null; // nothing to thread out of this node
        }
        const head = cur.children[0];
        if (head.kind !== 'atom') {
            return null;
        }
        const args = cur.children.slice(1);
        const threadedIdx = last ? args.length - 1 : 0;
        const threaded = args[threadedIdx];
        const others = args.filter((_, i) => i !== threadedIdx);
        const headText = text(src, head);
        const step =
            others.length === 0
                ? headText
                : `(${headText} ${others.map((a) => text(src, a)).join(' ')})`;
        steps.unshift(step);

        const threadable =
            threaded.kind === 'list' &&
            threaded.children.length >= 2 &&
            threaded.children[0].kind === 'atom';
        if (!threadable) {
            const body = [arrow, text(src, threaded), ...steps].join(' ');
            return { start: target.start, end: target.end, text: `(${body})` };
        }
        cur = threaded;
    }
}

/**
 * Unwind the `->` / `->>` pipeline at `offset` back into nested calls.
 * `(->> xs (filter p) (map f))` becomes `(map f (filter p xs))`.
 */
export function unthreadForm(src: string, offset: number): RefactorEdit | null {
    const path = pathAt(parseAll(src), offset);
    let form: Form | null = null;
    for (let i = path.length - 1; i >= 0; i--) {
        const name = headName(src, path[i]);
        if (name && ARROWS.has(name)) {
            form = path[i];
            break;
        }
    }
    if (!form) {
        return null;
    }
    const last = headName(src, form) === '->>';
    const parts = form.children.slice(1);
    if (parts.length === 0) {
        return null;
    }
    let expr = text(src, parts[0]);
    for (let i = 1; i < parts.length; i++) {
        const step = parts[i];
        if (step.kind === 'list' && step.children.length >= 1) {
            const head = text(src, step.children[0]);
            const rest = step.children.slice(1).map((c) => text(src, c));
            const restText = rest.length ? ' ' + rest.join(' ') : '';
            expr = last ? `(${head}${restText} ${expr})` : `(${head} ${expr}${restText})`;
        } else {
            expr = `(${text(src, step)} ${expr})`;
        }
    }
    return { start: form.start, end: form.end, text: expr };
}

const BRACKET_CYCLE: Record<string, [string, string]> = {
    '(': ['[', ']'],
    '[': ['{', '}'],
    '{': ['(', ')'],
};

/**
 * Cycle the delimiters of the enclosing collection: `(` → `[` → `{` → `(`.
 * Only plain list / vector / map forms cycle (not `#(` / `#{`).
 */
export function cycleCollection(src: string, offset: number): RefactorEdit | null {
    const form = enclosingContainer(src, offset);
    if (!form) {
        return null;
    }
    const open = src[form.bodyStart];
    const next = BRACKET_CYCLE[open];
    if (!next) {
        return null;
    }
    const inner = src.slice(form.bodyStart + 1, form.bodyEnd - 1);
    return { start: form.bodyStart, end: form.bodyEnd, text: `${next[0]}${inner}${next[1]}` };
}
