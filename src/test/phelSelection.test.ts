import * as assert from 'node:assert/strict';
import { expandSelection } from '../phelSelection';

describe('phelSelection.expandSelection', () => {
    it('expands an empty cursor to the innermost form', () => {
        const src = '(foo bar)';
        // cursor in "bar"
        const r = expandSelection(src, 6, 6);
        assert.deepEqual(r, { start: 5, end: 8 });
    });

    it('expands an atom to its enclosing list', () => {
        const src = '(foo bar)';
        const r = expandSelection(src, 5, 8);
        assert.deepEqual(r, { start: 0, end: 9 });
    });

    it('expands again to outer list', () => {
        const src = '(foo (bar baz))';
        // selection on `bar` (6..9)
        let r = expandSelection(src, 6, 9);
        assert.deepEqual(r, { start: 5, end: 14 });
        r = expandSelection(src, 5, 14);
        assert.deepEqual(r, { start: 0, end: 15 });
    });

    it('returns null when there is no larger form', () => {
        const src = '(a)';
        const r = expandSelection(src, 0, 3);
        assert.equal(r, null);
    });

    it('returns null on empty input', () => {
        assert.equal(expandSelection('', 0, 0), null);
    });

    it('expands cursor inside whitespace to the surrounding form', () => {
        const src = '(foo   bar)';
        const r = expandSelection(src, 5, 5);
        assert.deepEqual(r, { start: 0, end: 11 });
    });
});
