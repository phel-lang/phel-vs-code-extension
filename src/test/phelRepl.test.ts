import * as assert from 'node:assert/strict';
import { flattenForTerminal, nextTopLevelFormAfter, topLevelFormAt } from '../phelRepl';

describe('phelRepl.topLevelFormAt', () => {
    it('returns the form spanning the cursor', () => {
        const src = '(defn a [] 1)\n(defn b [] 2)';
        const f = topLevelFormAt(src, 5);
        assert.ok(f);
        assert.equal(f?.text, '(defn a [] 1)');
    });

    it('returns the second form when the cursor is in it', () => {
        const src = '(defn a [] 1)\n(defn b [] 2)';
        const f = topLevelFormAt(src, 20);
        assert.equal(f?.text, '(defn b [] 2)');
    });

    it('returns null between forms', () => {
        const src = '(a)\n\n(b)';
        const f = topLevelFormAt(src, 4);
        assert.equal(f, null);
    });

    it('skips line comments', () => {
        const src = '; comment\n(answer)';
        assert.equal(topLevelFormAt(src, 12)?.text, '(answer)');
    });
});

describe('phelRepl.nextTopLevelFormAfter', () => {
    it('returns the next top-level form after offset', () => {
        const src = '(a)\n(b)\n(c)';
        const f = nextTopLevelFormAfter(src, 4);
        assert.equal(f?.text, '(b)');
    });

    it('returns null past the last form', () => {
        const src = '(a)';
        assert.equal(nextTopLevelFormAfter(src, 10), null);
    });
});

describe('phelRepl.flattenForTerminal', () => {
    it('collapses newlines to single spaces', () => {
        assert.equal(flattenForTerminal('(defn a\n  []\n  1)'), '(defn a [] 1)');
    });

    it('preserves single-line input unchanged', () => {
        assert.equal(flattenForTerminal('(+ 1 2)'), '(+ 1 2)');
    });

    it('trims trailing whitespace', () => {
        assert.equal(flattenForTerminal('(+ 1 2)\n'), '(+ 1 2)');
    });
});
