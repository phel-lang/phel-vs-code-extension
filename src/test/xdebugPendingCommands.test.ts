import * as assert from 'node:assert/strict';
import { XdebugPendingCommands } from '../xdebugPendingCommands';

describe('XdebugPendingCommands', () => {
    let pending: XdebugPendingCommands;

    beforeEach(() => {
        pending = new XdebugPendingCommands();
    });

    it('delivers a response to the command that was waiting for it', () => {
        let got: string | undefined;
        pending.add(1, (r) => (got = r));
        assert.equal(pending.settle(1, '<response id="7"/>'), true);
        assert.equal(got, '<response id="7"/>');
        assert.equal(pending.size, 0);
    });

    it('routes by transaction id, not arrival order', () => {
        const seen: string[] = [];
        pending.add(1, (r) => seen.push('one:' + r));
        pending.add(2, (r) => seen.push('two:' + r));
        pending.settle(2, 'b');
        pending.settle(1, 'a');
        assert.deepEqual(seen, ['two:b', 'one:a']);
    });

    it('ignores a late or duplicate response', () => {
        let calls = 0;
        pending.add(1, () => calls++);
        assert.equal(pending.settle(1, 'x'), true);
        assert.equal(pending.settle(1, 'x'), false);
        assert.equal(calls, 1);
    });

    it('settleAll unblocks everything still in flight', () => {
        // The bug: the connection closing dropped these without settling, so
        // the awaiting caller hung — the timeout only fires for ids still
        // present, and clearing had already removed them.
        const settled: string[] = [];
        pending.add(1, (r) => settled.push(r));
        pending.add(2, (r) => settled.push(r));

        assert.equal(pending.settleAll(), 2);
        assert.deepEqual(settled, ['', '']);
        assert.equal(pending.size, 0);
    });

    it('settleAll is safe when nothing is in flight', () => {
        assert.equal(pending.settleAll(), 0);
    });

    it('abandon drops a command without settling it, for the timeout path', () => {
        let calls = 0;
        pending.add(1, () => calls++);
        assert.equal(pending.abandon(1), true);
        assert.equal(calls, 0, 'the timeout rejects instead of resolving');
        assert.equal(pending.abandon(1), false, 'already gone');
        assert.equal(pending.has(1), false);
    });

    it('does not settle a command the timeout already abandoned', () => {
        let calls = 0;
        pending.add(1, () => calls++);
        pending.abandon(1);
        assert.equal(pending.settle(1, 'late'), false);
        assert.equal(calls, 0);
    });
});
