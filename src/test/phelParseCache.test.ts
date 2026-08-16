import * as assert from 'node:assert/strict';
import { derive, parseAllCached } from '../phelParseCache';

/**
 * The cache is a module singleton, so every test uses source strings unique to
 * itself. Identity of the returned array is the observable signal: the same
 * array back means a hit, a fresh one means the entry was missing or evicted.
 */
describe('phelParseCache', () => {
    it('returns the same forms for the same source', () => {
        const src = '(hit-a 1) (hit-b 2)';
        const first = parseAllCached(src);
        const second = parseAllCached(src);
        assert.equal(first, second);
        assert.equal(first.length, 2);
    });

    it('hits on a separately built string with the same content', () => {
        // Content is the key, not the buffer a string came from: text retyped
        // back to what it was, or the same file opened twice, still hits.
        const src = '(rebuilt-source 1)';
        const rebuilt = ['(rebuilt', '-source 1)'].join('');
        const forms = parseAllCached(src);
        assert.equal(parseAllCached(rebuilt), forms);
    });

    it('re-parses a changed source and never serves the old forms', () => {
        const before = '(changed 1)';
        const after = '(changed 1) (changed 2)';
        const forms = parseAllCached(before);
        assert.equal(forms.length, 1);
        assert.equal(parseAllCached(after).length, 2);
        // The old source still maps to its own tree, not the new one.
        assert.equal(parseAllCached(before).length, 1);
    });

    it('evicts the least recently used entry past capacity', () => {
        const sources = Array.from({ length: 9 }, (_, i) => `(evict ${i})`);
        const oldest = parseAllCached(sources[0]);
        for (const src of sources.slice(1)) {
            parseAllCached(src);
        }
        // Nine distinct sources into eight slots: the first one is gone.
        assert.notEqual(parseAllCached(sources[0]), oldest);
        // …and the most recent ones are still there.
        const newest = parseAllCached(sources[8]);
        assert.equal(parseAllCached(sources[8]), newest);
    });

    it('memoises derive per key', () => {
        const src = '(derive-per-key 1)';
        let calls = 0;
        const compute = (): number => ++calls;
        assert.equal(derive(src, 'a', compute), 1);
        assert.equal(derive(src, 'a', compute), 1);
        assert.equal(derive(src, 'b', compute), 2);
        assert.equal(calls, 2);
    });

    it('memoises derive per source', () => {
        let calls = 0;
        const compute = (): number => ++calls;
        assert.equal(derive('(derive-per-src 1)', 'k', compute), 1);
        assert.equal(derive('(derive-per-src 2)', 'k', compute), 2);
        assert.equal(derive('(derive-per-src 1)', 'k', compute), 1);
        assert.equal(calls, 2);
    });

    it('keeps a falsy derived value cached', () => {
        const src = '(derive-falsy 1)';
        let calls = 0;
        const compute = (): number => {
            calls++;
            return 0;
        };
        assert.equal(derive(src, 'zero', compute), 0);
        assert.equal(derive(src, 'zero', compute), 0);
        assert.equal(calls, 1);
    });

    it('drops derived values with the entry they were computed from', () => {
        const src = '(derive-evicted 1)';
        let calls = 0;
        const compute = (): number => ++calls;
        assert.equal(derive(src, 'k', compute), 1);
        for (let i = 0; i < 8; i++) {
            parseAllCached(`(derive-evicted-filler ${i})`);
        }
        assert.equal(derive(src, 'k', compute), 2);
    });
});
