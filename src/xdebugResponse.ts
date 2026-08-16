// Reading the DBGp responses the adapter has to look inside: `breakpoint_set`,
// and the one that reports where execution stopped.
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

/** Where execution stopped, as `<xdebug:message>` reports it. */
export interface BreakLocation {
    /** The `file://` URI Xdebug named — still a URI, not a path. */
    fileUri: string;
    line: number;
}

/**
 * The location a `status="break"` response carries.
 *
 * Xdebug answers a `run` / `step_*` that ended in a breakpoint with
 *
 *   <response ... command="run" transaction_id="7" status="break" reason="ok">
 *     <xdebug:message filename="file:///tmp/phel/demo__a5b0.php" lineno="29"/>
 *   </response>
 *
 * and that is the only thing in the exchange that says *which* breakpoint was
 * hit: DBGp never names the breakpoint id. A logpoint is told apart from an
 * ordinary breakpoint by this location, so a response without one simply stops
 * (which is also what an exception break looks like: same element, plus an
 * `exception` attribute).
 */
export function parseBreakLocation(xml: string): BreakLocation | null {
    const message = /<xdebug:message\s+([^>]*)>/.exec(xml);
    if (!message) {
        return null;
    }
    const filename = /filename="([^"]*)"/.exec(message[1]);
    const lineno = /lineno="(\d+)"/.exec(message[1]);
    if (!filename || !lineno) {
        return null;
    }
    return { fileUri: filename[1], line: Number(lineno[1]) };
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
