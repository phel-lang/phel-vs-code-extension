// Pure structural-editing primitives for `.phel` source. No `vscode`
// imports so the logic can be unit-tested without an editor host.
//
// The `parseAll` reader produces a tree of `Form` nodes spanning the input.
// Edit operations return a `PareditEdit` describing a single textual replace
// plus an optional new cursor position; the VS Code provider applies them.

export type FormKind = 'list' | 'vector' | 'map' | 'set' | 'anon' | 'string' | 'char' | 'atom';

/**
 * A parsed form. Immutable: parse results are shared through `phelParseCache`,
 * so no consumer may edit a node another one is still reading.
 */
export interface Form {
    /** Offset of the first char of the form, including reader prefixes. */
    readonly start: number;
    /** Offset just past the last char of the form (exclusive). */
    readonly end: number;
    /** Offset of the opening bracket / first body char (after prefixes). */
    readonly bodyStart: number;
    /** Offset just after the closing bracket, or `end` for atoms / strings. */
    readonly bodyEnd: number;
    /** For container forms, offset just after the opener, else equal to `bodyStart`. */
    readonly innerStart: number;
    /** For container forms, offset of the closing bracket, else equal to `bodyEnd`. */
    readonly innerEnd: number;
    readonly kind: FormKind;
    readonly children: readonly Form[];
}

export interface PareditEdit {
    replaceStart: number;
    replaceEnd: number;
    replacement: string;
    cursor?: number;
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r', ',']);
const ATOM_TERMINATOR = new Set([
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
]);
const OPEN_TO_CLOSE: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

function skipTrivia(src: string, i: number, end: number): number {
    while (i < end) {
        const c = src[i];
        if (WHITESPACE.has(c)) {
            i++;
            continue;
        }
        if (c === ';') {
            while (i < end && src[i] !== '\n') {
                i++;
            }
            continue;
        }
        if (c === '#' && src[i + 1] === '|') {
            i += 2;
            while (i < end - 1 && !(src[i] === '|' && src[i + 1] === '#')) {
                i++;
            }
            if (i < end - 1) {
                i += 2;
            } else {
                i = end;
            }
            continue;
        }
        if (c === '#' && src[i + 1] === '_') {
            i += 2;
            const next = readForm(src, i, end);
            if (next) {
                i = next.end;
                continue;
            }
            return i;
        }
        return i;
    }
    return i;
}

function isReaderPrefix(src: string, i: number, end: number): number {
    if (i >= end) {
        return 0;
    }
    const c = src[i];
    if (c === "'" || c === '`' || c === '@' || c === '^') {
        return 1;
    }
    if (c === '~') {
        return src[i + 1] === '@' ? 2 : 1;
    }
    if (c === '#') {
        const n = src[i + 1];
        if (n === "'") {
            return 2;
        }
        if (n === '?' && src[i + 2] === '@') {
            return 3;
        }
        if (n === '?') {
            return 2;
        }
        // Tagged literal `#tag`, including EDN-style namespaced tags such as
        // `#my.app/Person` (but not `#(`, `#{`, `#_`, `#|`, `#"`).
        if (n && /[A-Za-z]/.test(n)) {
            let j = i + 1;
            while (j < end && /[A-Za-z0-9_\-./]/.test(src[j])) {
                j++;
            }
            return j - i;
        }
    }
    return 0;
}

function readPrefixes(src: string, start: number, end: number): number {
    let i = start;
    while (i < end) {
        const len = isReaderPrefix(src, i, end);
        if (len === 0) {
            break;
        }
        i += len;
        // Reader prefixes attach to the very next form; allow whitespace between
        // the prefix and the form (rare, but legal: `~\n  x`).
        i = skipTrivia(src, i, end);
    }
    return i;
}

function readString(src: string, start: number, end: number): number {
    let i = start + 1;
    while (i < end) {
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
    return end;
}

function readChar(src: string, start: number, end: number): number {
    let i = start + 1;
    while (i < end && !ATOM_TERMINATOR.has(src[i])) {
        i++;
    }
    if (i === start + 1 && i < end) {
        return i + 1;
    }
    return i;
}

function readAtomEnd(src: string, start: number, end: number): number {
    let i = start;
    while (i < end && !ATOM_TERMINATOR.has(src[i])) {
        i++;
    }
    return i;
}

/**
 * Read the next form at or after `start`. Returns null if there is no form
 * before `end`. Trivia (whitespace, comments, `#_` discards) is skipped.
 */
export function readForm(src: string, start: number, end: number): Form | null {
    const trivStart = skipTrivia(src, start, end);
    const formStart = trivStart;
    const bodyStart = readPrefixes(src, formStart, end);
    if (bodyStart >= end) {
        return null;
    }
    const c = src[bodyStart];
    if (c === ')' || c === ']' || c === '}') {
        return null;
    }

    const isHashContainer = c === '#' && (src[bodyStart + 1] === '(' || src[bodyStart + 1] === '{');
    if (isHashContainer) {
        const opener = src[bodyStart + 1];
        const close = OPEN_TO_CLOSE[opener];
        const innerStart = bodyStart + 2;
        const children: Form[] = [];
        let cursor = innerStart;
        while (cursor < end) {
            cursor = skipTrivia(src, cursor, end);
            if (cursor >= end) {
                break;
            }
            if (src[cursor] === close) {
                break;
            }
            const child = readForm(src, cursor, end);
            if (!child) {
                break;
            }
            children.push(child);
            cursor = child.end;
        }
        const innerEnd = cursor < end && src[cursor] === close ? cursor : cursor;
        const bodyEnd = innerEnd < end && src[innerEnd] === close ? innerEnd + 1 : innerEnd;
        return {
            start: formStart,
            end: bodyEnd,
            bodyStart,
            bodyEnd,
            innerStart,
            innerEnd,
            kind: opener === '(' ? 'anon' : 'set',
            children,
        };
    }

    if (c === '(' || c === '[' || c === '{') {
        const close = OPEN_TO_CLOSE[c];
        const innerStart = bodyStart + 1;
        const children: Form[] = [];
        let cursor = innerStart;
        while (cursor < end) {
            cursor = skipTrivia(src, cursor, end);
            if (cursor >= end) {
                break;
            }
            if (src[cursor] === close) {
                break;
            }
            const child = readForm(src, cursor, end);
            if (!child) {
                break;
            }
            children.push(child);
            cursor = child.end;
        }
        const innerEnd = cursor;
        const bodyEnd = innerEnd < end && src[innerEnd] === close ? innerEnd + 1 : innerEnd;
        const kind: FormKind = c === '(' ? 'list' : c === '[' ? 'vector' : 'map';
        return {
            start: formStart,
            end: bodyEnd,
            bodyStart,
            bodyEnd,
            innerStart,
            innerEnd,
            kind,
            children,
        };
    }

    // `"..."` and the regex literal `#"..."`, which is one form, not a `#`
    // atom followed by a string.
    if (c === '"' || (c === '#' && src[bodyStart + 1] === '"')) {
        const quoteStart = c === '"' ? bodyStart : bodyStart + 1;
        const stringEnd = readString(src, quoteStart, end);
        return {
            start: formStart,
            end: stringEnd,
            bodyStart,
            bodyEnd: stringEnd,
            innerStart: bodyStart,
            innerEnd: stringEnd,
            kind: 'string',
            children: [],
        };
    }

    if (c === '\\') {
        const charEnd = readChar(src, bodyStart, end);
        return {
            start: formStart,
            end: charEnd,
            bodyStart,
            bodyEnd: charEnd,
            innerStart: bodyStart,
            innerEnd: charEnd,
            kind: 'char',
            children: [],
        };
    }

    const atomEnd = readAtomEnd(src, bodyStart, end);
    if (atomEnd === bodyStart) {
        // Should not happen for well-formed input, but guard against infinite
        // loops by advancing one character.
        return {
            start: formStart,
            end: bodyStart + 1,
            bodyStart,
            bodyEnd: bodyStart + 1,
            innerStart: bodyStart,
            innerEnd: bodyStart + 1,
            kind: 'atom',
            children: [],
        };
    }
    return {
        start: formStart,
        end: atomEnd,
        bodyStart,
        bodyEnd: atomEnd,
        innerStart: bodyStart,
        innerEnd: atomEnd,
        kind: 'atom',
        children: [],
    };
}

/** Parse all top-level forms in `src`. */
export function parseAll(src: string): Form[] {
    const forms: Form[] = [];
    let i = 0;
    while (i < src.length) {
        const f = readForm(src, i, src.length);
        if (!f) {
            const skipped = skipTrivia(src, i, src.length);
            if (skipped <= i) {
                break;
            }
            i = skipped;
            continue;
        }
        forms.push(f);
        i = f.end;
    }
    return forms;
}

/**
 * Returns the path of forms enclosing `offset`, outermost first. Empty when
 * the offset is outside every form.
 */
export function pathAt(forms: readonly Form[], offset: number): Form[] {
    const path: Form[] = [];
    let level: readonly Form[] = forms;
    for (;;) {
        const hit = level.find((f) => f.start <= offset && offset <= f.end);
        if (!hit) {
            break;
        }
        path.push(hit);
        level = hit.children;
    }
    return path;
}

/** The smallest container (`list` | `vector` | `map` | `set` | `anon`) whose body strictly contains `offset`. */
export function enclosingContainer(forms: readonly Form[], offset: number): Form | null {
    const path = pathAt(forms, offset);
    for (let i = path.length - 1; i >= 0; i--) {
        const f = path[i];
        if (isContainer(f) && f.innerStart <= offset && offset <= f.innerEnd) {
            return f;
        }
    }
    return null;
}

export function isContainer(f: Form): boolean {
    return (
        f.kind === 'list' ||
        f.kind === 'vector' ||
        f.kind === 'map' ||
        f.kind === 'set' ||
        f.kind === 'anon'
    );
}

/** Form at offset (innermost). For containers prefers a child over the container itself. */
export function formAt(forms: readonly Form[], offset: number): Form | null {
    const path = pathAt(forms, offset);
    return path[path.length - 1] ?? null;
}

function siblingsAndIndex(
    forms: readonly Form[],
    container: Form
): { siblings: readonly Form[]; index: number } | null {
    if (forms.includes(container)) {
        return { siblings: forms, index: forms.indexOf(container) };
    }
    for (const f of forms) {
        const found = siblingsAndIndex(f.children, container);
        if (found) {
            return found;
        }
    }
    return null;
}

/**
 * Slurp the next sibling form into the container that encloses `offset`.
 * Moves the closing bracket of that container past the next sibling outside.
 */
export function slurpForward(src: string, offset: number): PareditEdit | null {
    const forms = parseAll(src);
    const container = enclosingContainer(forms, offset);
    if (!container) {
        return null;
    }
    const next = readForm(src, container.end, src.length);
    if (!next) {
        return null;
    }
    const close = src[container.innerEnd];
    const between = src.slice(container.end, next.start);
    const sep = between.length === 0 ? ' ' : '';
    return {
        replaceStart: container.innerEnd,
        replaceEnd: next.end,
        replacement: sep + src.slice(container.end, next.end) + close,
        cursor: offset,
    };
}

/**
 * Barf the last child of the enclosing container outside.
 * Moves the closing bracket back to before the last child.
 */
export function barfForward(src: string, offset: number): PareditEdit | null {
    const forms = parseAll(src);
    const container = enclosingContainer(forms, offset);
    if (!container || container.children.length === 0) {
        return null;
    }
    const last = container.children[container.children.length - 1];
    const close = src[container.innerEnd];
    // Need at least one whitespace between last and the new closer if there's a prev sibling.
    let insertBefore = last.start;
    // Trim trailing whitespace before `last` — keep the closer flush to last child end.
    let trimEnd = last.start;
    while (trimEnd > container.innerStart && WHITESPACE.has(src[trimEnd - 1])) {
        trimEnd--;
    }
    if (trimEnd <= container.innerStart) {
        // Only one child; just leave a single space inside.
        insertBefore = last.start;
    } else {
        insertBefore = trimEnd;
    }
    const replacement = close + src.slice(insertBefore, container.innerEnd);
    return {
        replaceStart: insertBefore,
        replaceEnd: container.innerEnd + 1,
        replacement,
        cursor: offset > container.innerEnd ? insertBefore : offset,
    };
}

function findPrevSibling(container: Form, parents: readonly Form[]): Form | null {
    const ctx = siblingsAndIndex(parents, container);
    if (!ctx) {
        return null;
    }
    return ctx.index > 0 ? ctx.siblings[ctx.index - 1] : null;
}

/**
 * Slurp the previous sibling into the container.
 * Moves the opening bracket back past the previous sibling.
 */
export function slurpBackward(src: string, offset: number): PareditEdit | null {
    const forms = parseAll(src);
    const container = enclosingContainer(forms, offset);
    if (!container) {
        return null;
    }
    const prev = findPrevSibling(container, forms);
    if (!prev) {
        return null;
    }
    const opener = src[container.bodyStart];
    const between = src.slice(prev.end, container.bodyStart);
    const sep = between.length === 0 ? ' ' : '';
    return {
        replaceStart: prev.start,
        replaceEnd: container.bodyStart + 1,
        replacement: opener + src.slice(prev.start, container.bodyStart) + sep,
        cursor: offset,
    };
}

/**
 * Barf the first child of the enclosing container backwards (out the front).
 */
export function barfBackward(src: string, offset: number): PareditEdit | null {
    const forms = parseAll(src);
    const container = enclosingContainer(forms, offset);
    if (!container || container.children.length === 0) {
        return null;
    }
    const first = container.children[0];
    const opener = src[container.bodyStart];
    // Place new opener after `first`, dropping any leading whitespace between
    // first and the next form.
    let insertAt = first.end;
    while (insertAt < container.innerEnd && WHITESPACE.has(src[insertAt])) {
        insertAt++;
    }
    if (insertAt >= container.innerEnd) {
        insertAt = first.end;
    }
    const replacement = src.slice(first.start, first.end) + ' ' + opener;
    return {
        replaceStart: container.bodyStart,
        replaceEnd: insertAt,
        replacement,
        cursor: offset < container.bodyStart + 1 ? insertAt : offset,
    };
}

/**
 * Replace the enclosing container with the form at the cursor.
 * `(foo (bar| baz))` -> `(bar baz)`.
 */
export function raise(src: string, offset: number): PareditEdit | null {
    const forms = parseAll(src);
    const path = pathAt(forms, offset);
    if (path.length < 2) {
        return null;
    }
    const target = path[path.length - 1];
    const container = path[path.length - 2];
    if (!isContainer(container)) {
        return null;
    }
    return {
        replaceStart: container.start,
        replaceEnd: container.end,
        replacement: src.slice(target.start, target.end),
        cursor: container.start,
    };
}

/**
 * Wrap the form at `offset` (or empty range if no form there) with the given
 * brackets. Cursor lands just after the open bracket.
 */
export function wrap(src: string, offset: number, open: '(' | '[' | '{'): PareditEdit {
    const close = OPEN_TO_CLOSE[open];
    const forms = parseAll(src);
    const target = formAt(forms, offset);
    if (!target) {
        return {
            replaceStart: offset,
            replaceEnd: offset,
            replacement: open + close,
            cursor: offset + 1,
        };
    }
    return {
        replaceStart: target.start,
        replaceEnd: target.end,
        replacement: open + src.slice(target.start, target.end) + close,
        cursor: target.start + 1,
    };
}

/** The form at `offset` together with its sibling list and index within it. */
function currentAndSiblings(
    forms: readonly Form[],
    offset: number
): { current: Form; siblings: readonly Form[]; index: number } | null {
    const path = pathAt(forms, offset);
    if (path.length === 0) {
        return null;
    }
    const current = path[path.length - 1];
    const parent = path.length >= 2 ? path[path.length - 2] : null;
    const siblings = parent ? parent.children : forms;
    const index = siblings.indexOf(current);
    if (index < 0) {
        return null;
    }
    return { current, siblings, index };
}

/** Swap the form at `offset` with its next sibling, preserving the separator. */
export function dragForward(src: string, offset: number): PareditEdit | null {
    const ctx = currentAndSiblings(parseAll(src), offset);
    if (!ctx || ctx.index + 1 >= ctx.siblings.length) {
        return null;
    }
    const a = ctx.siblings[ctx.index];
    const b = ctx.siblings[ctx.index + 1];
    const sep = src.slice(a.end, b.start);
    const aText = src.slice(a.start, a.end);
    const bText = src.slice(b.start, b.end);
    return {
        replaceStart: a.start,
        replaceEnd: b.end,
        replacement: bText + sep + aText,
        cursor: a.start + bText.length + sep.length + (offset - a.start),
    };
}

/** Swap the form at `offset` with its previous sibling, preserving the separator. */
export function dragBackward(src: string, offset: number): PareditEdit | null {
    const ctx = currentAndSiblings(parseAll(src), offset);
    if (!ctx || ctx.index === 0) {
        return null;
    }
    const a = ctx.siblings[ctx.index - 1];
    const b = ctx.siblings[ctx.index];
    const sep = src.slice(a.end, b.start);
    const aText = src.slice(a.start, a.end);
    const bText = src.slice(b.start, b.end);
    return {
        replaceStart: a.start,
        replaceEnd: b.end,
        replacement: bText + sep + aText,
        cursor: a.start + (offset - b.start),
    };
}

/** Remove the enclosing container's brackets, lifting its children into the parent. */
export function spliceForm(src: string, offset: number): PareditEdit | null {
    const container = enclosingContainer(parseAll(src), offset);
    if (!container) {
        return null;
    }
    // Only plain containers: splicing `#(` / `#{` would leave a dangling `#`.
    if (container.kind !== 'list' && container.kind !== 'vector' && container.kind !== 'map') {
        return null;
    }
    const removedBefore = container.innerStart - container.start;
    return {
        replaceStart: container.start,
        replaceEnd: container.end,
        replacement: src.slice(container.innerStart, container.innerEnd),
        cursor: Math.max(container.start, offset - removedBefore),
    };
}

/** Delete the form at `offset` (innermost), tidying one adjacent space. */
export function killForm(src: string, offset: number): PareditEdit | null {
    const target = formAt(parseAll(src), offset);
    if (!target) {
        return null;
    }
    let end = target.end;
    while (end < src.length && (src[end] === ' ' || src[end] === '\t')) {
        end++;
    }
    let start = target.start;
    if (end === target.end) {
        // Nothing trailing consumed; drop one leading space instead.
        while (start > 0 && (src[start - 1] === ' ' || src[start - 1] === '\t')) {
            start--;
        }
    }
    return { replaceStart: start, replaceEnd: end, replacement: '', cursor: start };
}
