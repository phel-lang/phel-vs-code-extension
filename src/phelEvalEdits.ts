// Pure edits for the two evaluation commands that write into the buffer:
// commenting a result under the form it came from, and replacing a form with
// its value. No `vscode` import, so the offset math is unit-testable without an
// editor host.
//
// Evaluating the same form twice has to update the comment rather than stack a
// second one under it, so the block written last time is found and replaced.
// "The block" is the `;; =>` line plus the lines a multi-line value spilled
// onto, which are padded to line up under the first one — that padding is also
// what tells them apart from an ordinary `;; note` written under a result,
// which is left where it is.

/** A single replacement, in offsets into the source it was computed from. */
export interface EvalEdit {
    start: number;
    end: number;
    text: string;
}

/** What every result line is commented out with. */
const COMMENT = ';; ';
/** Marks the first line of a result block. */
const ARROW = '=> ';
/** Further value lines, indented so the value stays in one column. */
const CONTINUATION = COMMENT + ' '.repeat(ARROW.length);

/** The `;; =>` line a block starts with. */
const BLOCK_HEAD_RE = /^;;\s*=>/;
/** A line the same block continues on: the padding, or a blank value line. */
const BLOCK_CONT_RE = /^;;( {4}|$)/;

/**
 * Write `value` as a `;; => …` comment on the line after the form ending at
 * `formEnd`, replacing the block already there. Every line of a multi-line
 * value gets its own comment line.
 */
export function commentResultEdit(src: string, formEnd: number, value: string): EvalEdit {
    const start = lineEndAt(src, formEnd);
    return { start, end: blockEndBelow(src, start), text: `\n${commentLines(value)}` };
}

/** Replace the form spanning `form` with `value` — "evaluate and replace". */
export function replaceFormEdit(form: { start: number; end: number }, value: string): EvalEdit {
    return { start: form.start, end: form.end, text: value };
}

/** Offset of the newline ending the line `offset` is on, or the end of `src`. */
function lineEndAt(src: string, offset: number): number {
    const nl = src.indexOf('\n', offset);
    return nl < 0 ? src.length : nl;
}

/**
 * End of the result block directly below the line ending at `lineEnd`, or
 * `lineEnd` itself when there is none — which is then an insertion point.
 */
function blockEndBelow(src: string, lineEnd: number): number {
    let end = lineEnd;
    let sawHead = false;
    while (src[end] === '\n') {
        const next = lineEndAt(src, end + 1);
        const line = src.slice(end + 1, next);
        const belongs = sawHead ? BLOCK_CONT_RE.test(line) : BLOCK_HEAD_RE.test(line);
        if (!belongs) {
            return end;
        }
        sawHead = true;
        end = next;
    }
    return end;
}

/** `value` as comment lines: `;; => first`, then one padded line per further line. */
function commentLines(value: string): string {
    return value
        .split(/\r?\n/)
        .map((line, index) => `${index === 0 ? COMMENT + ARROW : CONTINUATION}${line}`.trimEnd())
        .join('\n');
}
