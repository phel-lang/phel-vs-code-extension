import * as assert from 'node:assert/strict';
import { resolveLocalAt, localOccurrences, localsInScopeAt } from '../phelScope';

/** Offset of the `nth` (0-based) occurrence of `token` in `src`. */
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

function occStarts(src: string, offset: number): number[] {
    const b = resolveLocalAt(src, offset);
    assert.ok(b, 'expected a local binding');
    return localOccurrences(src, b).map((o) => o.start);
}

describe('phelScope.resolveLocalAt', () => {
    it('resolves a let-bound local from a use', () => {
        const src = '(let [x 1] (+ x x))';
        const b = resolveLocalAt(src, idx(src, 'x', 1));
        assert.ok(b);
        assert.equal(b.name, 'x');
        assert.equal(b.declStart, idx(src, 'x', 0));
    });

    it('resolves from the declaration itself', () => {
        const src = '(let [x 1] x)';
        const b = resolveLocalAt(src, idx(src, 'x', 0));
        assert.ok(b);
        assert.equal(b.declStart, idx(src, 'x', 0));
    });

    it('returns null for a global def name', () => {
        const src = '(def answer 42)\n(+ answer 1)';
        assert.equal(resolveLocalAt(src, idx(src, 'answer', 0)), null);
        assert.equal(resolveLocalAt(src, idx(src, 'answer', 1)), null);
    });

    it('returns null for a core symbol', () => {
        const src = '(map inc [1 2 3])';
        assert.equal(resolveLocalAt(src, idx(src, 'map')), null);
        assert.equal(resolveLocalAt(src, idx(src, 'inc')), null);
    });

    it('does not treat a defn name as a local', () => {
        const src = '(defn foo [a] (foo a))';
        assert.equal(resolveLocalAt(src, idx(src, 'foo', 0)), null);
        assert.equal(resolveLocalAt(src, idx(src, 'foo', 1)), null);
        assert.ok(resolveLocalAt(src, idx(src, 'a', 1)));
    });

    it('resolves a named fn self-reference as local', () => {
        const src = '(fn fact [n] (fact n))';
        const b = resolveLocalAt(src, idx(src, 'fact', 1));
        assert.ok(b);
        assert.equal(b.declStart, idx(src, 'fact', 0));
    });
});

describe('phelScope.localOccurrences', () => {
    it('collects declaration and uses of a let local', () => {
        const src = '(let [x 1] (+ x x))';
        assert.deepEqual(occStarts(src, idx(src, 'x', 1)), [
            idx(src, 'x', 0),
            idx(src, 'x', 1),
            idx(src, 'x', 2),
        ]);
    });

    it('excludes a same-named global outside the scope', () => {
        const src = '(def x 1)\n(let [x 2] x)';
        // Rename target is the *local* x; the global def x must be untouched.
        assert.deepEqual(occStarts(src, idx(src, 'x', 2)), [
            idx(src, 'x', 1),
            idx(src, 'x', 2),
        ]);
    });

    it('respects inner shadowing (a nested let re-binds the name)', () => {
        const src = '(let [x 1] (list x (let [x 2] x) x))';
        // Outer x: decl + the two outer uses, but NOT the inner shadow.
        const outer = occStarts(src, idx(src, 'x', 0));
        assert.deepEqual(outer, [idx(src, 'x', 0), idx(src, 'x', 1), idx(src, 'x', 4)]);
        // Inner x: its own decl + use only.
        const inner = occStarts(src, idx(src, 'x', 2));
        assert.deepEqual(inner, [idx(src, 'x', 2), idx(src, 'x', 3)]);
    });

    it('keeps separate fn arities apart', () => {
        const src = '(fn ([a] a) ([a b] (+ a b)))';
        // First arity a: decl + one use.
        assert.deepEqual(occStarts(src, idx(src, 'a', 1)), [
            idx(src, 'a', 0),
            idx(src, 'a', 1),
        ]);
    });

    it('scopes fn parameters', () => {
        const src = '(fn [a b] (+ a b))';
        assert.deepEqual(occStarts(src, idx(src, 'a', 1)), [idx(src, 'a', 0), idx(src, 'a', 1)]);
    });
});

describe('phelScope destructuring', () => {
    it('binds vector destructuring names', () => {
        const src = '(let [[a b] xs] (+ a b))';
        assert.deepEqual(occStarts(src, idx(src, 'a', 1)), [idx(src, 'a', 0), idx(src, 'a', 1)]);
    });

    it('binds :keys map destructuring', () => {
        const src = '(let [{:keys [x y]} m] (+ x y))';
        assert.deepEqual(occStarts(src, idx(src, 'x', 1)), [idx(src, 'x', 0), idx(src, 'x', 1)]);
    });

    it('binds :as map destructuring', () => {
        const src = '(let [{:as whole} m] whole)';
        assert.deepEqual(occStarts(src, idx(src, 'whole', 1)), [
            idx(src, 'whole', 0),
            idx(src, 'whole', 1),
        ]);
    });
});

describe('phelScope binding forms', () => {
    it('binds when-let targets', () => {
        const src = '(when-let [v (find x)] (use v))';
        const b = resolveLocalAt(src, idx(src, 'v', 1));
        assert.ok(b);
        assert.equal(b.declStart, idx(src, 'v', 0));
    });

    it('binds a catch exception var with a php class type', () => {
        const src = '(try (boom) (catch \\Throwable ex (log ex)))';
        const b = resolveLocalAt(src, idx(src, 'ex', 1));
        assert.ok(b);
        assert.equal(b.name, 'ex');
        assert.deepEqual(localOccurrences(src, b).map((o) => o.start), [
            idx(src, 'ex', 0),
            idx(src, 'ex', 1),
        ]);
    });

    it('binds a for loop var', () => {
        const src = '(for [x :in coll] (inc x))';
        assert.deepEqual(occStarts(src, idx(src, 'x', 1)), [idx(src, 'x', 0), idx(src, 'x', 1)]);
    });

    it('binds a doseq loop var', () => {
        const src = '(doseq [x coll] (print x))';
        assert.deepEqual(occStarts(src, idx(src, 'x', 1)), [idx(src, 'x', 0), idx(src, 'x', 1)]);
    });

    it('binds foreach key/value vars but not the collection', () => {
        const src = '(foreach [k v m] (print k v))';
        assert.deepEqual(occStarts(src, idx(src, 'k', 1)), [idx(src, 'k', 0), idx(src, 'k', 1)]);
        assert.deepEqual(occStarts(src, idx(src, 'v', 1)), [idx(src, 'v', 0), idx(src, 'v', 1)]);
        // `m` is the collection, not a binding.
        assert.equal(resolveLocalAt(src, idx(src, 'm', 0)), null);
    });
});

describe('phelScope.localsInScopeAt', () => {
    it('lists params and let names visible in the body', () => {
        const src = '(defn f [a b] (let [c 1] BODY))';
        // Cursor at the BODY marker sees a, b and c.
        const inBody = localsInScopeAt(src, idx(src, 'BODY'));
        assert.ok(inBody.includes('a'));
        assert.ok(inBody.includes('b'));
        assert.ok(inBody.includes('c'));
    });

    it('does not leak locals outside their form', () => {
        const src = '(defn f [a] a)\n(defn g [b] b)';
        const inG = localsInScopeAt(src, idx(src, 'b', 1));
        assert.ok(inG.includes('b'));
        assert.ok(!inG.includes('a'));
    });
});
