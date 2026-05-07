import * as assert from 'node:assert/strict';
import { findInlineCandidates } from '../phelInlineValues';

function names(occ: ReturnType<typeof findInlineCandidates>): string[] {
    return occ.map((o) => o.name);
}

describe('phelInlineValues.findInlineCandidates', () => {
    it('extracts plain symbols', () => {
        const src = '(let [x 1 y 2] (+ x y))';
        assert.deepEqual(names(findInlineCandidates(src, 0, 0)), ['let', 'x', 'y', 'x', 'y']);
    });

    it('skips keywords', () => {
        const src = '(assoc m :a 1)';
        assert.deepEqual(names(findInlineCandidates(src, 0, 0)), ['assoc', 'm']);
    });

    it('skips strings and comments', () => {
        const src = '(println "x" foo) ; bar';
        assert.deepEqual(names(findInlineCandidates(src, 0, 0)), ['println', 'foo']);
    });

    it('skips operator-like names', () => {
        const src = '(+ a b)';
        assert.deepEqual(names(findInlineCandidates(src, 0, 0)), ['a', 'b']);
    });

    it('skips ns-qualified symbols', () => {
        const src = '(my.ns/foo a)';
        assert.deepEqual(names(findInlineCandidates(src, 0, 0)), ['a']);
    });

    it('respects line range', () => {
        const src = 'x\ny\nz';
        assert.deepEqual(names(findInlineCandidates(src, 1, 1)), ['y']);
    });

    it('returns line/column positions', () => {
        const src = '(println foo)';
        const occ = findInlineCandidates(src, 0, 0);
        const foo = occ.find((o) => o.name === 'foo');
        assert.ok(foo);
        assert.equal(foo?.line, 0);
        assert.equal(foo?.column, 9);
    });
});
