import * as assert from 'node:assert/strict';
import { dragForward, dragBackward, spliceForm, killForm, type PareditEdit } from '../phelParedit';

function idx(src: string, token: string, nth = 0): number {
    let i = -1;
    for (let k = 0; k <= nth; k++) {
        i = src.indexOf(token, i + 1);
        if (i < 0) {
            throw new Error(`token ${token} #${nth} not found`);
        }
    }
    return i;
}

function apply(src: string, edit: PareditEdit | null): string {
    assert.ok(edit, 'expected edit, got null');
    return src.slice(0, edit.replaceStart) + edit.replacement + src.slice(edit.replaceEnd);
}

describe('phelParedit.dragForward / dragBackward', () => {
    it('swaps a form with its next sibling', () => {
        const src = '(a b c)';
        assert.equal(apply(src, dragForward(src, idx(src, 'b'))), '(a c b)');
    });

    it('swaps a form with its previous sibling', () => {
        const src = '(a b c)';
        assert.equal(apply(src, dragBackward(src, idx(src, 'c'))), '(a c b)');
    });

    it('returns null at the forward edge', () => {
        const src = '(a b c)';
        assert.equal(dragForward(src, idx(src, 'c')), null);
    });

    it('returns null at the backward edge', () => {
        const src = '(a b c)';
        assert.equal(dragBackward(src, idx(src, 'a')), null);
    });
});

describe('phelParedit.spliceForm', () => {
    it('removes the enclosing brackets, lifting children up', () => {
        const src = '(a (b c) d)';
        assert.equal(apply(src, spliceForm(src, idx(src, 'b'))), '(a b c d)');
    });
});

describe('phelParedit.killForm', () => {
    it('deletes the form at the cursor and a trailing space', () => {
        const src = '(a b c)';
        assert.equal(apply(src, killForm(src, idx(src, 'b'))), '(a c)');
    });
});
