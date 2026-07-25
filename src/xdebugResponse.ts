// Reading a DBGp `breakpoint_set` response.
//
// Captured from Xdebug 3, setting a line breakpoint that later stops execution:
//
//   <response xmlns="urn:debugger_protocol_v1"
//             xmlns:xdebug="https://xdebug.org/dbgp/xdebug"
//             command="breakpoint_set" transaction_id="1" id="463430001"></response>
//
// Two things that response teaches, both of which the adapter used to get
// wrong:
//
//   * `transaction_id="1"` *contains* `id="1"`, so a plain /id="(\d+)"/ picks
//     up the transaction id and never the breakpoint id;
//   * there is no `resolved` and no `state` attribute. Treating their absence
//     as failure marks every successfully installed breakpoint as failed.
//
// DBGp says a command succeeded unless the response carries an `<error>`, so
// that is what decides success here.
//
// Split out of the debug adapter because that class cannot be constructed
// outside a live debug session; this part is pure, so it can be tested.

export interface BreakpointSetResult {
    /** Xdebug's breakpoint id, needed to remove it later. */
    id: string | null;
    /** Whether the engine accepted the breakpoint. */
    ok: boolean;
    /** Error text when the engine rejected it. */
    error?: string;
}

/**
 * The `id` attribute of the element itself, ignoring attributes that merely end
 * in `id` such as `transaction_id`.
 */
export function parseBreakpointId(xml: string): string | null {
    return /(?:^|[\s"'])id="(\d+)"/.exec(xml)?.[1] ?? null;
}

export function parseBreakpointSetResponse(xml: string): BreakpointSetResult {
    const error = /<error[^>]*>(?:.*?<message><!\[CDATA\[(.*?)\]\]><\/message>)?/s.exec(xml);
    if (error) {
        return { id: null, ok: false, error: error[1] ?? 'breakpoint rejected' };
    }
    const id = parseBreakpointId(xml);
    // No `<error>` means the engine took it. Xdebug reports `resolved` only
    // when breakpoint resolution is enabled, so its absence proves nothing.
    return { id, ok: id !== null };
}
