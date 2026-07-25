import * as assert from 'node:assert/strict';
import { parseBreakpointId, parseBreakpointSetResponse } from '../xdebugResponse';

// Captured verbatim from Xdebug 3 setting a line breakpoint that then stopped
// execution — so this is a *successful* set, with no resolved/state attribute.
const REAL_OK =
    '<?xml version="1.0" encoding="iso-8859-1"?>' +
    '<response xmlns="urn:debugger_protocol_v1" xmlns:xdebug="https://xdebug.org/dbgp/xdebug" ' +
    'command="breakpoint_set" transaction_id="1" id="463430001"></response>';

const REAL_ERROR =
    '<response xmlns="urn:debugger_protocol_v1" command="breakpoint_set" transaction_id="4">' +
    '<error code="200"><message><![CDATA[breakpoint could not be set]]></message></error></response>';

describe('parseBreakpointId', () => {
    it('does not mistake transaction_id for the breakpoint id', () => {
        // `transaction_id="1"` contains `id="1"`, so a plain /id="(\d+)"/
        // matched the transaction id and never the breakpoint.
        assert.equal(parseBreakpointId(REAL_OK), '463430001');
    });

    it('reads the id whichever order the attributes come in', () => {
        assert.equal(parseBreakpointId('<response id="7" transaction_id="99"/>'), '7');
        assert.equal(parseBreakpointId('<response transaction_id="99" id="7"/>'), '7');
    });

    it('returns null when there is no id', () => {
        assert.equal(parseBreakpointId('<response transaction_id="3"/>'), null);
    });
});

describe('parseBreakpointSetResponse', () => {
    it('treats a real successful set as success', () => {
        // Xdebug omits `resolved` and `state` here. Requiring them meant every
        // working breakpoint was reported as failed, and the UI left it
        // unverified even though the engine stopped on it.
        const r = parseBreakpointSetResponse(REAL_OK);
        assert.equal(r.ok, true);
        assert.equal(r.id, '463430001');
    });

    it('captures the id so the breakpoint can be removed later', () => {
        // The removal path stores this id; storing the transaction id instead
        // meant `breakpoint_remove -d 1` never removed anything.
        assert.equal(parseBreakpointSetResponse(REAL_OK).id, '463430001');
    });

    it('treats an error response as failure', () => {
        const r = parseBreakpointSetResponse(REAL_ERROR);
        assert.equal(r.ok, false);
        assert.equal(r.id, null);
        assert.equal(r.error, 'breakpoint could not be set');
    });

    it('still succeeds when the engine does report resolved', () => {
        const xml = '<response command="breakpoint_set" transaction_id="2" id="5" resolved="1"/>';
        const r = parseBreakpointSetResponse(xml);
        assert.equal(r.ok, true);
        assert.equal(r.id, '5');
    });

    it('fails when there is neither an id nor an error', () => {
        assert.equal(parseBreakpointSetResponse('<response transaction_id="9"/>').ok, false);
    });
});
