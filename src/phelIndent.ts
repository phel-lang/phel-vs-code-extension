// Where a line belongs, computed the way `phel format` computes it.
//
// The formatter itself is a CLI round-trip through a temp file (see
// `phelFormatProvider`), which is far too slow to run on Enter — and anything
// we guessed differently would be undone on the next save. So the rules below
// mirror phel-lang's `IndentRule` and the three indenters it drives
// (`InnerIndenter`, `BlockIndenter`, `ListIndenter`) closely enough that a line
// indented here is a line `phel format` leaves alone.
//
// Two places the two part ways on purpose:
//
//   * `phel format` never re-indents a line whose first token is a comment
//     (`IndentRule::shouldIndent`), it only preserves the indentation that
//     comment already had. A comment being typed has none yet, so it gets the
//     same treatment as code — which the formatter then keeps.
//   * a closing bracket alone on a line is indented here, while the formatter
//     pulls it up onto the previous line instead
//     (`RemoveSurroundingWhitespaceRule`). The one shape where it cannot —
//     a container whose last child is a comment — ends up at column 0, since
//     `RemoveTrailingWhitespaceRule` strips the indentation it was just given.
//     That shape is one line in the whole of phel's stdlib (`npm run sweep`),
//     and mirroring it would mean flushing every `)` to column 0 as it is typed.
//
// No `vscode` import, so `npm run sweep` can measure this against a real corpus.

import { enclosingContainer, formAt, type Form } from './phelParedit';
import { parseAllCached } from './phelParseCache';

/** The one indent step, as `IndentRule::INDENT_WIDTH` hard-codes it. */
const INDENT_WIDTH = 2;

/**
 * Heads whose body sits `INDENT_WIDTH` right of the form's own column, no
 * matter what else is on the head line.
 *
 * Mirrors `FormatterFactory::INNER_INDENT_SYMBOLS`
 * (phel-lang 0.50, `src/php/Formatter/FormatterFactory.php:40-44`).
 * `phelIndent.test.ts` pins the list, so a phel bump that touches it has to be
 * looked at rather than assumed.
 */
export const INNER_INDENT_HEADS: ReadonlySet<string> = new Set([
    'def',
    'def-',
    'defn',
    'defn-',
    'defmacro',
    'defmacro-',
    'deftest',
    'defbench',
    'fn',
    'defstruct',
    'defrecord',
    'definterface',
    'defexception',
    'defenum',
    'defprotocol',
    'defmulti',
    'defmethod',
    'defonce',
    'reify',
]);

/**
 * Heads that indent their body like the ones above, but only once the argument
 * after their fixed ones starts a line of its own; while it still sits on the
 * head line the form aligns like any other call. The number is how many fixed
 * arguments come before the body.
 *
 * Mirrors `FormatterFactory::BLOCK_INDENT_SYMBOLS`
 * (phel-lang 0.50, `src/php/Formatter/FormatterFactory.php:52-63`).
 */
export const BLOCK_INDENT_HEADS: ReadonlyMap<string, number> = new Map([
    ['do', 0],
    ['cond', 0],
    ['try', 0],
    ['finally', 0],
    ['with-output-buffer', 0],
    ['delay', 0],
    ['lazy-seq', 0],
    ['with-isolated-stats', 0],
    ['with-isolated-reporters', 1],
    ['if', 1],
    ['if-not', 1],
    ['foreach', 1],
    ['for', 1],
    ['dofor', 1],
    ['let', 1],
    ['ns', 1],
    ['loop', 1],
    ['case', 1],
    ['when', 1],
    ['when-not', 1],
    ['when-let', 1],
    ['when-some', 1],
    ['if-let', 1],
    ['if-some', 1],
    ['binding', 1],
    ['when-first', 1],
    ['doseq', 1],
    ['dotimes', 1],
    ['letfn', 1],
    ['with-redefs', 1],
    ['with-bindings', 1],
    ['with-open', 1],
    ['extend-type', 1],
    ['extend-protocol', 1],
    ['catch', 2],
    ['condp', 2],
]);

/** A replacement for the leading whitespace of one line. */
export interface IndentEdit {
    /** Offset of the first character of the line. */
    start: number;
    /** Offset just past the leading whitespace being replaced. */
    end: number;
    /** The indentation the line should start with. Spaces, as the CLI writes. */
    text: string;
}

/**
 * The column the line starting at `offset` should be indented to.
 *
 * `null` means "leave this line alone": the offset is inside a multi-line
 * string, where the leading whitespace is content and not indentation.
 */
export function indentationAt(src: string, offset: number): number | null {
    const forms = parseAllCached(src);
    if (insideMultiLineString(forms, offset)) {
        return null;
    }
    // Unclosed forms are the normal case while typing; `parseAll` ends them at
    // the end of the buffer, so the enclosing container is still found.
    const container = enclosingContainer(forms, offset);
    if (!container) {
        return 0;
    }
    // Only `(…)` gets the head rules. Vectors, maps, sets and `#(…)` align on
    // the column right after their opener, which is where their first child
    // sits once the formatter has removed the whitespace behind it.
    if (container.kind !== 'list') {
        return columnOf(src, container.innerStart);
    }
    return listIndentation(src, container, offset);
}

/**
 * The edit that gives the line starting at `lineStart` the indentation
 * `indentationAt` asks for, or `null` when it already has it.
 */
export function reindentLine(src: string, lineStart: number): IndentEdit | null {
    const column = indentationAt(src, lineStart);
    if (column === null) {
        return null;
    }
    let end = lineStart;
    while (end < src.length && (src[end] === ' ' || src[end] === '\t')) {
        end++;
    }
    const text = ' '.repeat(column);
    if (src.slice(lineStart, end) === text) {
        return null;
    }
    return { start: lineStart, end, text };
}

/** The three list rules, in the order `IndentRule::customIndent` tries them. */
function listIndentation(src: string, list: Form, offset: number): number {
    const children = valueChildren(src, list);
    const head = headSymbol(src, children[0], list.innerStart);
    if (head !== null) {
        if (INNER_INDENT_HEADS.has(head)) {
            return innerIndent(src, list);
        }
        const fixedArgs = BLOCK_INDENT_HEADS.get(head);
        if (fixedArgs !== undefined) {
            const body = children[fixedArgs + 1];
            if (!body || startsLine(src, body.start, list.innerStart)) {
                return innerIndent(src, list);
            }
        }
    }
    return listAlign(src, list, children, offset);
}

/** `InnerIndenter`: one step right of the column the form itself starts at. */
function innerIndent(src: string, list: Form): number {
    return columnOf(src, list.bodyStart) + INDENT_WIDTH;
}

/**
 * `ListIndenter`: a line that follows the head alone aligns under the head,
 * every later one under the form's first argument — wherever that argument
 * happens to sit, which is what makes `(-> x` line its steps up under `x`.
 */
function listAlign(src: string, list: Form, children: readonly Form[], offset: number): number {
    const preceding = children.filter((child) => child.start < offset).length;
    const anchor = preceding > 1 ? children[1].start : list.innerStart;
    return columnOf(src, anchor);
}

/**
 * The head of a list as the formatter reads it: a plain symbol directly on the
 * opener's line, with any namespace dropped (`Symbol::create` splits on the
 * first `/`, so `foo/let` really does indent like `let`).
 */
function headSymbol(src: string, head: Form | undefined, innerStart: number): string | null {
    // A reader prefix (`'foo`) wraps the head in another node, which the
    // formatter's symbol match then misses.
    if (!head || head.kind !== 'atom' || head.start !== head.bodyStart) {
        return null;
    }
    if (src.slice(innerStart, head.start).includes('\n')) {
        return null;
    }
    const text = src.slice(head.start, head.end);
    const slash = text.indexOf('/');
    return slash === -1 || text === '/' ? text : text.slice(slash + 1);
}

/**
 * The children of `list` the way the formatter's parse tree has them, where a
 * metadata marker is not a node of its own but wraps the form it is attached
 * to: `(^string [x y]` is one argument to the enclosing `defn`, not two, and
 * the body of that arity therefore aligns under `^`, not under `[`.
 */
function valueChildren(src: string, list: Form): readonly Form[] {
    if (!list.children.some((child) => isMeta(src, child))) {
        return list.children;
    }
    const children: Form[] = [];
    let meta: Form | undefined;
    for (const child of list.children) {
        if (isMeta(src, child)) {
            meta ??= child;
            continue;
        }
        children.push(meta ? { ...child, start: meta.start } : child);
        meta = undefined;
    }
    // A marker with nothing after it yet, which is what half-typed metadata is.
    if (meta) {
        children.push(meta);
    }
    return children;
}

/** Whether `form` is a `^…` metadata marker rather than a value of its own. */
function isMeta(src: string, form: Form): boolean {
    return form.start < form.bodyStart && src[form.start] === '^';
}

/** Whether the form at `start` is the first thing on its line. */
function startsLine(src: string, start: number, innerStart: number): boolean {
    let i = start - 1;
    while (i >= innerStart && (src[i] === ' ' || src[i] === '\t' || src[i] === ',')) {
        i--;
    }
    // A line comment ends at its newline, so "after a comment" is "after a
    // newline" here — the case `BlockIndenter::firstFormInLine` spells out.
    return i < innerStart || src[i] === '\n';
}

/** Column of `offset`, counting characters from the start of its line. */
function columnOf(src: string, offset: number): number {
    return offset - (src.lastIndexOf('\n', offset - 1) + 1);
}

/** Whether `offset` sits inside a string literal rather than between forms. */
function insideMultiLineString(forms: readonly Form[], offset: number): boolean {
    const form = formAt(forms, offset);
    return form?.kind === 'string' && offset > form.start && offset < form.end;
}
