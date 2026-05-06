// Pure helpers for the diagnostics-on-save provider:
//
// `phel analyze <file>` prints a JSON array of diagnostic objects on stdout.
// `parsePhelAnalyzeOutput` turns that into a typed list, tolerating noise
// (banner / trailing newline / non-JSON pre-amble) by walking forward to the
// first `[` that opens a valid JSON array. Each entry is normalised so the
// VS Code provider can map it to `vscode.Diagnostic` without further parsing.
//
// Kept free of `vscode` imports to make unit testing straightforward.

export type PhelSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface PhelDiagnostic {
    /** Phel diagnostic code, e.g. `"PHEL001"`. */
    code?: string;
    /** Severity bucket. Unknown values fall through as `"info"`. */
    severity: PhelSeverity;
    /** Human-readable message. */
    message: string;
    /** Absolute path of the offending file (as reported by phel). */
    uri?: string;
    /** 1-based line number where the diagnostic starts. */
    startLine: number;
    /** 1-based column number where the diagnostic starts. */
    startCol: number;
    /** 1-based line number where the diagnostic ends. */
    endLine: number;
    /** 1-based column number where the diagnostic ends. */
    endCol: number;
}

/**
 * Parse the stdout of `phel analyze`. Returns an empty array when the file
 * has no issues (phel emits `[]`). When the output cannot be parsed as JSON
 * the function returns an empty array rather than throwing - the caller
 * usually wants to drop the diagnostics silently and try again on the next
 * save.
 */
export function parsePhelAnalyzeOutput(stdout: string): PhelDiagnostic[] {
    const trimmed = stdout.trim();
    if (!trimmed) {
        return [];
    }

    const start = trimmed.indexOf('[');
    if (start < 0) {
        return [];
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed.slice(start));
    } catch {
        return [];
    }

    if (!Array.isArray(parsed)) {
        return [];
    }

    const out: PhelDiagnostic[] = [];
    for (const raw of parsed) {
        const diag = normaliseEntry(raw);
        if (diag) {
            out.push(diag);
        }
    }
    return out;
}

function normaliseEntry(raw: unknown): PhelDiagnostic | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const r = raw as Record<string, unknown>;

    const message = typeof r.message === 'string' ? r.message : null;
    if (!message) {
        return null;
    }

    const startLine = toFiniteInt(r.startLine);
    const startCol = toFiniteInt(r.startCol);
    if (startLine === null || startCol === null) {
        return null;
    }

    const endLine = toFiniteInt(r.endLine) ?? startLine;
    const endCol = toFiniteInt(r.endCol) ?? startCol;

    const diag: PhelDiagnostic = {
        message,
        severity: toSeverity(r.severity),
        startLine,
        startCol,
        endLine,
        endCol,
    };
    if (typeof r.code === 'string' && r.code) {
        diag.code = r.code;
    }
    if (typeof r.uri === 'string' && r.uri) {
        diag.uri = r.uri;
    }
    return diag;
}

function toFiniteInt(value: unknown): number | null {
    if (typeof value !== 'number') {
        return null;
    }
    if (!Number.isFinite(value)) {
        return null;
    }
    return Math.trunc(value);
}

function toSeverity(value: unknown): PhelSeverity {
    if (typeof value !== 'string') {
        return 'info';
    }
    switch (value.toLowerCase()) {
        case 'error':
            return 'error';
        case 'warning':
        case 'warn':
            return 'warning';
        case 'info':
        case 'note':
            return 'info';
        case 'hint':
            return 'hint';
        default:
            return 'info';
    }
}

/**
 * Convert a 1-based phel diagnostic to the half-open 0-based range
 * VS Code uses. `endCol` is treated as exclusive in the output (matching
 * `phel analyze`'s convention where it points one past the last char).
 */
export function toZeroBasedRange(diag: PhelDiagnostic): {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
} {
    const startLine = Math.max(0, diag.startLine - 1);
    const startCol = Math.max(0, diag.startCol - 1);
    const endLine = Math.max(startLine, diag.endLine - 1);
    let endCol = Math.max(0, diag.endCol - 1);
    if (endLine === startLine && endCol <= startCol) {
        // Empty range — VS Code prefers a 1-char wide marker for visibility.
        endCol = startCol + 1;
    }
    return { startLine, startCol, endLine, endCol };
}
