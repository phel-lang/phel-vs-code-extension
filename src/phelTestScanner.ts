// Pure scanner that pulls `(deftest name ...)` and `(defbench name ...)`
// declarations out of a Phel source string. Top-level only (the form must start
// at the beginning of a line, modulo leading whitespace) so we don't pick up
// false positives inside `(comment ...)` blocks or strings.
//
// Each result reports the 0-based line and the 0-based column of the name, so
// the CodeLens can attach itself to the right token.

export interface PhelTestRef {
    /** Test or benchmark name as it appears in source. */
    name: string;
    /** 0-based line of the defining form. */
    line: number;
    /** 0-based column where the name starts. */
    nameCol: number;
}

/**
 * Matches `(<head> <name>` at the start of a line.
 *
 * Optional metadata before the name takes either the keyword-shorthand form
 * (`^:slow`) or the map form (`^{:slow true}`); both are skipped. `defbench`
 * forwards the same metadata to the function it defines, so the two forms have
 * an identical head shape — `defbench`'s own option map (`{:revs 10000}`) comes
 * *after* the name and is not part of this match.
 */
function headRegex(head: string): RegExp {
    return new RegExp(
        `^[ \\t]*\\(${head}\\s+(?:\\^(?::[^\\s()[\\]{}]+|\\{[^}]*\\})\\s+)?([^\\s()[\\]{}]+)`,
        'gm'
    );
}

function findDefinitions(source: string, head: string): PhelTestRef[] {
    const out: PhelTestRef[] = [];
    const re = headRegex(head);
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
        const fullMatch = match[0];
        const name = match[1];
        const nameStart = match.index + fullMatch.length - name.length;
        const before = source.slice(0, nameStart);
        const lastNewline = before.lastIndexOf('\n');
        const line = (before.match(/\n/g) ?? []).length;
        const nameCol = lastNewline < 0 ? nameStart : nameStart - lastNewline - 1;
        out.push({ name, line, nameCol });
    }
    return out;
}

export function findDeftests(source: string): PhelTestRef[] {
    return findDefinitions(source, 'deftest');
}

/** `(defbench name ...)` declarations, per `phel.bench` (Phel 0.50). */
export function findDefbenches(source: string): PhelTestRef[] {
    return findDefinitions(source, 'defbench');
}
