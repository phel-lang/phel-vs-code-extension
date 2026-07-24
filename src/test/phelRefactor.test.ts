import * as assert from 'node:assert/strict';
import { threadForm, unthreadForm, cycleCollection } from '../phelRefactor';

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

function apply(src: string, edit: ReturnType<typeof threadForm>): string {
    assert.ok(edit, 'expected a refactor edit');
    return src.slice(0, edit.start) + edit.text + src.slice(edit.end);
}

describe('phelRefactor.threadForm', () => {
    it('threads first (->), unwinding the spine', () => {
        const src = '(f (g x))';
        assert.equal(apply(src, threadForm(src, idx(src, 'f'), false)), '(-> x g f)');
    });

    it('keeps extra args on the step while unwinding fully', () => {
        const src = '(f (g x) y)';
        assert.equal(apply(src, threadForm(src, idx(src, 'f'), false)), '(-> x g (f y))');
    });

    it('threads last (->>) for seq pipelines', () => {
        const src = '(map f (filter p xs))';
        assert.equal(
            apply(src, threadForm(src, idx(src, 'map'), true)),
            '(->> xs (filter p) (map f))'
        );
    });

    it('threads a single call', () => {
        const src = '(inc x)';
        assert.equal(apply(src, threadForm(src, idx(src, 'inc'), false)), '(-> x inc)');
    });

    it('refuses an already-threaded form', () => {
        const src = '(-> x f g)';
        assert.equal(threadForm(src, idx(src, 'x'), false), null);
    });
});

describe('phelRefactor.unthreadForm', () => {
    it('unwinds a -> chain', () => {
        const src = '(-> x g f)';
        assert.equal(apply(src, unthreadForm(src, idx(src, 'x'))), '(f (g x))');
    });

    it('unwinds a ->> chain with steps', () => {
        const src = '(->> xs (filter p) (map f))';
        assert.equal(apply(src, unthreadForm(src, idx(src, 'xs'))), '(map f (filter p xs))');
    });

    it('returns null outside a thread', () => {
        const src = '(f x)';
        assert.equal(unthreadForm(src, idx(src, 'x')), null);
    });
});

describe('phelRefactor.cycleCollection', () => {
    it('cycles ( -> [', () => {
        const src = '(a b)';
        assert.equal(apply(src, cycleCollection(src, idx(src, 'a'))), '[a b]');
    });

    it('cycles [ -> {', () => {
        const src = '[1 2 3]';
        assert.equal(apply(src, cycleCollection(src, idx(src, '1'))), '{1 2 3}');
    });

    it('cycles { -> (', () => {
        const src = '{:a 1}';
        assert.equal(apply(src, cycleCollection(src, idx(src, ':a'))), '(:a 1)');
    });
});
