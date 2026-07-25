import * as assert from 'node:assert/strict';
import { XdebugBreakpointRegistry } from '../xdebugBreakpointRegistry';

describe('XdebugBreakpointRegistry', () => {
    let registry: XdebugBreakpointRegistry;

    beforeEach(() => {
        registry = new XdebugBreakpointRegistry();
    });

    it('keeps every id installed for a source', () => {
        // One Phel line can map to several PHP candidate lines, so a single
        // editor breakpoint installs more than one engine breakpoint.
        registry.record('/a.phel', '1');
        registry.record('/a.phel', '2');
        assert.deepEqual([...registry.peek('/a.phel')], ['1', '2']);
        assert.equal(registry.size, 2);
    });

    it('keeps sources apart', () => {
        registry.record('/a.phel', '1');
        registry.record('/b.phel', '2');
        assert.deepEqual([...registry.peek('/a.phel')], ['1']);
        assert.deepEqual([...registry.peek('/b.phel')], ['2']);
    });

    it('take returns the ids and forgets them', () => {
        registry.record('/a.phel', '1');
        registry.record('/a.phel', '2');
        assert.deepEqual(registry.take('/a.phel'), ['1', '2']);
        assert.deepEqual(registry.take('/a.phel'), []);
        assert.equal(registry.size, 0);
    });

    it('take leaves other sources untouched', () => {
        registry.record('/a.phel', '1');
        registry.record('/b.phel', '2');
        registry.take('/a.phel');
        assert.deepEqual([...registry.peek('/b.phel')], ['2']);
    });

    it('take on an unknown source is empty, not undefined', () => {
        assert.deepEqual(registry.take('/never-seen.phel'), []);
    });

    it('models the toggle cycle that used to leak breakpoints', () => {
        // set → the engine installs 2; unset → both must come back to be removed;
        // set again → the new ids are tracked on their own, not appended to the old.
        registry.record('/a.phel', '1');
        registry.record('/a.phel', '2');
        assert.deepEqual(registry.take('/a.phel'), ['1', '2']);

        registry.record('/a.phel', '3');
        assert.deepEqual(registry.take('/a.phel'), ['3']);
        assert.equal(registry.size, 0);
    });

    it('clear forgets every source', () => {
        registry.record('/a.phel', '1');
        registry.record('/b.phel', '2');
        registry.clear();
        assert.equal(registry.size, 0);
        assert.deepEqual([...registry.peek('/a.phel')], []);
    });
});
