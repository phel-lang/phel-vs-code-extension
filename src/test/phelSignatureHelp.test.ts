import * as assert from 'assert';
import {
    findCurrentCall,
    parseSignatureParams,
    hasRest,
    clampActiveParam,
    pickActiveSignature,
} from '../phelSignatureHelp';

describe('findCurrentCall', function () {
    function at(text: string): { source: string; offset: number } {
        const offset = text.indexOf('|');
        assert.ok(offset >= 0, "test text must contain a '|' marking the cursor");
        return { source: text.replace('|', ''), offset };
    }

    it('returns null when the cursor is at the top level', function () {
        const { source, offset } = at('|');
        assert.strictEqual(findCurrentCall(source, offset), null);
    });

    it('reports the callee on the first arg before any space', function () {
        const { source, offset } = at('(map |');
        const r = findCurrentCall(source, offset);
        assert.deepStrictEqual(r, { callee: 'map', calleeStart: 1, activeArg: 0 });
    });

    it('keeps activeArg=0 while typing the first argument', function () {
        const { source, offset } = at('(map inc|');
        assert.deepStrictEqual(findCurrentCall(source, offset), {
            callee: 'map',
            calleeStart: 1,
            activeArg: 0,
        });
    });

    it('advances activeArg after each argument-separating space', function () {
        const { source, offset } = at('(map inc |');
        assert.deepStrictEqual(findCurrentCall(source, offset), {
            callee: 'map',
            calleeStart: 1,
            activeArg: 1,
        });
    });

    it('counts a finished argument the moment its closing delimiter is seen', function () {
        const { source, offset } = at('(reduce + 0 [1 2 3] |');
        assert.deepStrictEqual(findCurrentCall(source, offset), {
            callee: 'reduce',
            calleeStart: 1,
            activeArg: 3,
        });
    });

    it('returns the innermost call when forms are nested', function () {
        const { source, offset } = at('(map (filter pred |xs) ys)');
        assert.deepStrictEqual(findCurrentCall(source, offset), {
            callee: 'filter',
            calleeStart: 6,
            activeArg: 1,
        });
    });

    it('skips over strings inside arguments', function () {
        const { source, offset } = at('(println "hello (world)" |');
        assert.deepStrictEqual(findCurrentCall(source, offset), {
            callee: 'println',
            calleeStart: 1,
            activeArg: 1,
        });
    });

    it('skips over line comments', function () {
        const { source, offset } = at('(reduce + ;; comment\n0 |[1 2])');
        assert.deepStrictEqual(findCurrentCall(source, offset), {
            callee: 'reduce',
            calleeStart: 1,
            activeArg: 2,
        });
    });

    it('returns null when only inside a vector or map literal', function () {
        const a = at('[1 2 |3]');
        assert.strictEqual(findCurrentCall(a.source, a.offset), null);
        const b = at('{:a |1}');
        assert.strictEqual(findCurrentCall(b.source, b.offset), null);
    });

    it('returns null when nothing has been typed after the open paren', function () {
        const { source, offset } = at('(|');
        assert.strictEqual(findCurrentCall(source, offset), null);
    });

    it('handles qualified callees', function () {
        const { source, offset } = at('(phel.test/is |x)');
        assert.deepStrictEqual(findCurrentCall(source, offset), {
            callee: 'phel.test/is',
            calleeStart: 1,
            activeArg: 0,
        });
    });
});

describe('parseSignatureParams', function () {
    it('splits a flat parameter list', function () {
        assert.deepStrictEqual(parseSignatureParams('(assoc m k v)'), ['m', 'k', 'v']);
    });

    it('glues `&` to the rest parameter', function () {
        assert.deepStrictEqual(parseSignatureParams('(map f & xs)'), ['f', '& xs']);
    });

    it('returns an empty list when the form has no parameters', function () {
        assert.deepStrictEqual(parseSignatureParams('(now)'), []);
    });

    it('returns an empty list for malformed input', function () {
        assert.deepStrictEqual(parseSignatureParams('not a signature'), []);
    });
});

describe('hasRest', function () {
    it('returns true when the last param starts with `&`', function () {
        assert.strictEqual(hasRest(['f', '& xs']), true);
    });

    it('returns false otherwise', function () {
        assert.strictEqual(hasRest(['m', 'k', 'v']), false);
        assert.strictEqual(hasRest([]), false);
    });
});

describe('clampActiveParam', function () {
    it('returns -1 when there are no params', function () {
        assert.strictEqual(clampActiveParam([], 0), -1);
    });

    it('clamps negative input to 0', function () {
        assert.strictEqual(clampActiveParam(['a', 'b'], -3), 0);
    });

    it('returns the index unchanged when in range', function () {
        assert.strictEqual(clampActiveParam(['a', 'b', 'c'], 1), 1);
    });

    it('routes overflow to the rest parameter when present', function () {
        assert.strictEqual(clampActiveParam(['f', '& xs'], 7), 1);
    });

    it('clamps overflow to the last param when no rest exists', function () {
        assert.strictEqual(clampActiveParam(['a', 'b'], 5), 1);
    });
});

describe('pickActiveSignature', function () {
    it('returns 0 when there is a single arity', function () {
        assert.strictEqual(pickActiveSignature(['(foo a b)'], 1), 0);
    });

    it('picks the first arity that contains the active arg', function () {
        const arities = ['(foo)', '(foo a)', '(foo a b)'];
        assert.strictEqual(pickActiveSignature(arities, 0), 1);
        assert.strictEqual(pickActiveSignature(arities, 1), 2);
    });

    it('falls back to a rest-arity when no fixed arity fits', function () {
        const arities = ['(foo a)', '(foo a & rest)'];
        assert.strictEqual(pickActiveSignature(arities, 4), 1);
    });

    it('returns the last arity when nothing fits and no rest exists', function () {
        const arities = ['(foo)', '(foo a)'];
        assert.strictEqual(pickActiveSignature(arities, 5), 1);
    });
});
