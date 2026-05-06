// Pure helpers for the format-on-save provider. The provider itself shells
// `phel format` against a temp file (the CLI does not yet read from stdin),
// so the only logic worth unit-testing here is the decision of whether to
// emit an edit and the line/column conversion.

export interface FormatRange {
    /** 0-based line where the edit starts. */
    startLine: number;
    /** 0-based column where the edit starts. */
    startCol: number;
    /** 0-based line where the edit ends. */
    endLine: number;
    /** 0-based column where the edit ends. */
    endCol: number;
}

export interface FormatEdit {
    range: FormatRange;
    newText: string;
}

/**
 * Returns a single full-document replace edit when `formatted` differs from
 * `original`, or an empty array when the two are identical.
 *
 * The range covers the whole document, expressed via the line/column of the
 * last character: `{0:0 .. lastLine:lastCol}`. The provider passes that to
 * `vscode.Range` / `vscode.TextEdit.replace`.
 */
export function buildFormatEdits(original: string, formatted: string): FormatEdit[] {
    if (original === formatted) {
        return [];
    }
    return [
        {
            range: rangeOfDocument(original),
            newText: formatted,
        },
    ];
}

/**
 * Compute a line/column range that spans the entire `text`. An empty
 * document collapses to `{0:0 .. 0:0}`.
 */
export function rangeOfDocument(text: string): FormatRange {
    if (text.length === 0) {
        return { startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
    }
    const lines = text.split('\n');
    const endLine = lines.length - 1;
    const endCol = lines[endLine].length;
    return { startLine: 0, startCol: 0, endLine, endCol };
}
