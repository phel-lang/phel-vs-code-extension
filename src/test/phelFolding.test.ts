import * as assert from 'node:assert/strict';
import { computeFoldRanges } from '../phelFolding';

describe('phelFolding.computeFoldRanges', () => {
    it('folds a multi-line form from its first to last line', () => {
        const src = '(defn f [a]\n  (+ a 1))';
        assert.ok(computeFoldRanges(src).some((r) => r.start === 0 && r.end === 1 && !r.comment));
    });

    it('does not fold a single-line form', () => {
        assert.deepEqual(computeFoldRanges('(inc x)'), []);
    });

    it('folds a run of consecutive line comments', () => {
        const src = '; one\n; two\n; three\n(def x 1)';
        assert.ok(computeFoldRanges(src).some((r) => r.comment && r.start === 0 && r.end === 2));
    });

    it('does not fold a lone comment line', () => {
        const src = '; solo\n(def x 1)';
        assert.ok(!computeFoldRanges(src).some((r) => r.comment));
    });
});
