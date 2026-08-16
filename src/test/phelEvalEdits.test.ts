import * as assert from 'node:assert/strict';
import { commentResultEdit, replaceFormEdit } from '../phelEvalEdits';

/** Apply an edit the way the provider does, so the tests read as before/after. */
function apply(src: string, edit: { start: number; end: number; text: string }): string {
    return src.slice(0, edit.start) + edit.text + src.slice(edit.end);
}

describe('phelEvalEdits.commentResultEdit', () => {
    it('writes the value on the line after the form', () => {
        const src = '(+ 1 2)\n';
        assert.equal(apply(src, commentResultEdit(src, 7, '3')), '(+ 1 2)\n;; => 3\n');
    });

    it('writes it at the end of a buffer with no trailing newline', () => {
        const src = '(+ 1 2)';
        assert.equal(apply(src, commentResultEdit(src, 7, '3')), '(+ 1 2)\n;; => 3');
    });

    it('keeps what follows the form', () => {
        const src = '(+ 1 2)\n(str "a")\n';
        assert.equal(apply(src, commentResultEdit(src, 7, '3')), '(+ 1 2)\n;; => 3\n(str "a")\n');
    });

    it('replaces the block a previous evaluation left', () => {
        const src = '(+ 1 2)\n;; => 3\n(str "a")\n';
        assert.equal(apply(src, commentResultEdit(src, 7, '4')), '(+ 1 2)\n;; => 4\n(str "a")\n');
    });

    it('replaces a multi-line block with a shorter value', () => {
        const src = '(table)\n;; => first\n;;    second\n(next)\n';
        assert.equal(apply(src, commentResultEdit(src, 7, 'nil')), '(table)\n;; => nil\n(next)\n');
    });

    it('comments every line of a multi-line value, padded into one column', () => {
        const src = '(table)\n';
        assert.equal(
            apply(src, commentResultEdit(src, 7, 'first\nsecond')),
            '(table)\n;; => first\n;;    second\n'
        );
    });

    it('leaves a comment separated by a blank line alone', () => {
        const src = '(+ 1 2)\n\n;; => stale\n';
        assert.equal(
            apply(src, commentResultEdit(src, 7, '3')),
            '(+ 1 2)\n;; => 3\n\n;; => stale\n'
        );
    });

    it('does not eat a plain comment that is not a result block', () => {
        const src = '(+ 1 2)\n;; explain the form\n';
        assert.equal(
            apply(src, commentResultEdit(src, 7, '3')),
            '(+ 1 2)\n;; => 3\n;; explain the form\n'
        );
    });

    it('keeps a comment written under an existing result block', () => {
        const src = '(+ 1 2)\n;; => 3\n;; explain the form\n';
        assert.equal(
            apply(src, commentResultEdit(src, 7, '4')),
            '(+ 1 2)\n;; => 4\n;; explain the form\n'
        );
    });

    it('writes after the whole line when the form has a trailing comment', () => {
        const src = '(+ 1 2) ; sum\nnext\n';
        assert.equal(apply(src, commentResultEdit(src, 7, '3')), '(+ 1 2) ; sum\n;; => 3\nnext\n');
    });

    it('leaves no trailing whitespace on an empty value line', () => {
        const src = '(x)\n';
        assert.equal(
            apply(src, commentResultEdit(src, 3, 'a\n\nb')),
            '(x)\n;; => a\n;;\n;;    b\n'
        );
    });
});

describe('phelEvalEdits.replaceFormEdit', () => {
    it('spans exactly the form', () => {
        const src = '(def a 1)\n(str "a" "b")\n';
        const edit = replaceFormEdit({ start: 10, end: 23 }, '"ab"');
        assert.deepEqual(edit, { start: 10, end: 23, text: '"ab"' });
        assert.equal(apply(src, edit), '(def a 1)\n"ab"\n');
    });

    it('replaces a form spanning several lines', () => {
        const src = '(+ 1\n   2)';
        assert.equal(apply(src, replaceFormEdit({ start: 0, end: src.length }, '3')), '3');
    });
});
