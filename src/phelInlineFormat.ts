// Pure formatting for inline evaluation results: collapse a (possibly
// multi-line) nREPL value or error into a single, length-bounded line suitable
// for an end-of-line decoration. No `vscode` import, so it is unit-testable.

const DEFAULT_MAX = 120;

/** Collapse whitespace and clip to `max` characters with an ellipsis. */
export function oneLine(s: string, max = DEFAULT_MAX): string {
    const collapsed = s.replace(/\s+/g, ' ').trim();
    return collapsed.length > max ? collapsed.slice(0, max - 1) + '…' : collapsed;
}

/**
 * Render an nREPL op result as a one-line inline string. Errors take the error
 * text; success joins the returned values (empty → `nil`).
 */
export function formatInlineResult(
    values: readonly string[],
    err: string,
    isError: boolean,
    max = DEFAULT_MAX
): string {
    if (isError) {
        return oneLine(err || 'error', max);
    }
    return oneLine(values.join(', ') || 'nil', max);
}
