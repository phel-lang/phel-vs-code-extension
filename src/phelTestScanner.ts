// Pure scanner that pulls `(deftest name ...)` declarations out of a Phel
// source string. Top-level only (the form must start at the beginning of a
// line, modulo leading whitespace) so we don't pick up false positives
// inside `(comment ...)` blocks or strings.
//
// Each result reports the 0-based line and the 0-based column of the test
// name, so the CodeLens can attach itself to the right token.

export interface PhelTestRef {
    /** Test name as it appears in source. */
    name: string;
    /** 0-based line of the `(deftest` form. */
    line: number;
    /** 0-based column where the test name starts. */
    nameCol: number;
}

// Optional metadata before the test name takes either the keyword-shorthand
// form (`^:slow`) or the map form (`^{:slow true}`); both are skipped.
const DEFTEST_RE = /^[ \t]*\((deftest)\s+(?:\^(?::[^\s()[\]{}]+|\{[^}]*\})\s+)?([^\s()[\]{}]+)/gm;

export function findDeftests(source: string): PhelTestRef[] {
    const out: PhelTestRef[] = [];
    DEFTEST_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = DEFTEST_RE.exec(source)) !== null) {
        const fullMatch = match[0];
        const name = match[2];
        const matchStart = match.index;
        const nameStart = matchStart + fullMatch.length - name.length;
        const before = source.slice(0, nameStart);
        const lastNewline = before.lastIndexOf('\n');
        const line = (before.match(/\n/g) ?? []).length;
        const nameCol = lastNewline < 0 ? nameStart : nameStart - lastNewline - 1;
        out.push({ name, line, nameCol });
    }
    return out;
}
