import * as assert from 'node:assert/strict';
import { findOccurrences, isValidSymbolName } from '../phelReferences';

function offsets(occ: ReturnType<typeof findOccurrences>): number[] {
    return occ.map((o) => o.start);
}

describe('phelReferences.findOccurrences', () => {
    it('finds standalone occurrences', () => {
        const src = '(foo bar foo)';
        assert.deepEqual(offsets(findOccurrences(src, 'foo')), [1, 9]);
    });

    it('does not match substrings', () => {
        const src = '(foobar foo-bar foo)';
        assert.deepEqual(offsets(findOccurrences(src, 'foo')), [16]);
    });

    it('skips strings', () => {
        const src = '(foo "foo" foo)';
        assert.deepEqual(offsets(findOccurrences(src, 'foo')), [1, 11]);
    });

    it('skips line comments', () => {
        const src = '(foo)\n; foo here\n(foo)';
        assert.deepEqual(offsets(findOccurrences(src, 'foo')), [1, 18]);
    });

    it('skips block comments', () => {
        const src = '(foo) #| foo |# (foo)';
        assert.deepEqual(offsets(findOccurrences(src, 'foo')), [1, 17]);
    });

    it('skips char literals', () => {
        const src = '(foo \\f foo)';
        assert.deepEqual(offsets(findOccurrences(src, 'foo')), [1, 8]);
    });

    it('matches at end of file', () => {
        const src = '(let [x foo])\nfoo';
        assert.deepEqual(offsets(findOccurrences(src, 'foo')), [8, 14]);
    });

    it('matches symbols with special chars', () => {
        const src = '(my-fn? a) (my-fn? b)';
        assert.deepEqual(offsets(findOccurrences(src, 'my-fn?')), [1, 12]);
    });

    it('returns empty for empty name', () => {
        assert.deepEqual(findOccurrences('foo', ''), []);
    });
});

describe('phelReferences.isValidSymbolName', () => {
    it('accepts plain symbols', () => {
        assert.equal(isValidSymbolName('foo'), true);
        assert.equal(isValidSymbolName('my-fn?'), true);
        assert.equal(isValidSymbolName('+'), true);
    });

    it('rejects empty names', () => {
        assert.equal(isValidSymbolName(''), false);
    });

    it('rejects names with delimiters', () => {
        assert.equal(isValidSymbolName('foo bar'), false);
        assert.equal(isValidSymbolName('foo)'), false);
        assert.equal(isValidSymbolName('"foo"'), false);
    });
});
