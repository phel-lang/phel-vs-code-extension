import * as assert from 'assert';
import { buildFormatEdits, rangeOfDocument } from '../phelFormat';

describe('rangeOfDocument', function () {
    it('collapses to 0:0..0:0 for an empty string', function () {
        assert.deepStrictEqual(rangeOfDocument(''), {
            startLine: 0,
            startCol: 0,
            endLine: 0,
            endCol: 0,
        });
    });

    it('reports the end of a single-line document', function () {
        assert.deepStrictEqual(rangeOfDocument('hello'), {
            startLine: 0,
            startCol: 0,
            endLine: 0,
            endCol: 5,
        });
    });

    it('reports the end of the last line in a multi-line document', function () {
        const text = 'first line\nsecond longer line\nthird';
        assert.deepStrictEqual(rangeOfDocument(text), {
            startLine: 0,
            startCol: 0,
            endLine: 2,
            endCol: 5,
        });
    });

    it('treats a trailing newline as an empty final line', function () {
        assert.deepStrictEqual(rangeOfDocument('x\n'), {
            startLine: 0,
            startCol: 0,
            endLine: 1,
            endCol: 0,
        });
    });
});

describe('buildFormatEdits', function () {
    it('emits no edits when the formatter is a no-op', function () {
        const same = '(defn id [x] x)\n';
        assert.deepStrictEqual(buildFormatEdits(same, same), []);
    });

    it('emits a full-document replace edit when the text differs', function () {
        const original = '(defn  id [x ] x)\n';
        const formatted = '(defn id [x] x)\n';
        const edits = buildFormatEdits(original, formatted);
        assert.strictEqual(edits.length, 1);
        assert.strictEqual(edits[0].newText, formatted);
        assert.deepStrictEqual(edits[0].range, rangeOfDocument(original));
    });

    it('handles an empty original', function () {
        const edits = buildFormatEdits('', 'now-non-empty');
        assert.strictEqual(edits.length, 1);
        assert.deepStrictEqual(edits[0].range, {
            startLine: 0,
            startCol: 0,
            endLine: 0,
            endCol: 0,
        });
    });
});
