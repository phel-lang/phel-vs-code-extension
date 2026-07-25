import * as assert from 'node:assert/strict';
import {
    resolveLocalAt,
    localOccurrences,
    localsInScopeAt,
    collectAllBindings,
    findUnusedLocals,
} from '../phelScope';

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
        assert.deepEqual(occStarts(src, idx(src, 'x', 2)), [idx(src, 'x', 1), idx(src, 'x', 2)]);
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
        assert.deepEqual(occStarts(src, idx(src, 'a', 1)), [idx(src, 'a', 0), idx(src, 'a', 1)]);
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
        assert.deepEqual(
            localOccurrences(src, b).map((o) => o.start),
            [idx(src, 'ex', 0), idx(src, 'ex', 1)]
        );
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

    it('binds a dotimes counter', () => {
        const src = '(dotimes [q 5] (use q))';
        assert.deepEqual(occStarts(src, idx(src, 'q', 1)), [idx(src, 'q', 0), idx(src, 'q', 1)]);
    });

    it('binds a when-first target', () => {
        const src = '(when-first [x coll] (print x))';
        assert.deepEqual(occStarts(src, idx(src, 'x', 1)), [idx(src, 'x', 0), idx(src, 'x', 1)]);
    });

    it('binds the as-> threading name', () => {
        const src = '(as-> 1 v (+ v 2) (* v 3))';
        assert.deepEqual(occStarts(src, idx(src, 'v', 1)), [
            idx(src, 'v', 0),
            idx(src, 'v', 1),
            idx(src, 'v', 2),
        ]);
    });

    it('binds every for clause, not just the first', () => {
        const src = '(for [x :in coll y :in other] (+ x y))';
        assert.deepEqual(occStarts(src, idx(src, 'y', 1)), [idx(src, 'y', 0), idx(src, 'y', 1)]);
        assert.deepEqual(occStarts(src, idx(src, 'x', 1)), [idx(src, 'x', 0), idx(src, 'x', 1)]);
    });

    it('binds the for :reduce accumulator', () => {
        const src = '(for [x :in coll :reduce [acc 0]] (+ acc x))';
        assert.deepEqual(occStarts(src, idx(src, 'acc', 1)), [
            idx(src, 'acc', 0),
            idx(src, 'acc', 1),
        ]);
    });

    it('binds letfn names across every spec and the body', () => {
        const src = '(letfn [(p [a] (q a)) (q [b] b)] (p 1))';
        // `q` is called from inside `p`'s body, before its own spec: letfn
        // names are mutually recursive, so a use may precede the declaration.
        assert.deepEqual(occStarts(src, idx(src, 'q', 0)), [idx(src, 'q', 0), idx(src, 'q', 1)]);
        assert.deepEqual(occStarts(src, idx(src, 'p', 0)), [idx(src, 'p', 0), idx(src, 'p', 1)]);
    });

    it('scopes letfn parameters to their own spec', () => {
        const src = '(letfn [(p [a] (php/abs a)) (q [a] a)] 1)';
        // The two `a` parameters are distinct bindings, not one shared local.
        assert.deepEqual(occStarts(src, idx(src, 'a', 0)), [idx(src, 'a', 0), idx(src, 'a', 2)]);
        assert.deepEqual(occStarts(src, idx(src, 'a', 3)), [idx(src, 'a', 3), idx(src, 'a', 4)]);
    });

    it('binds protocol-method parameters in a defrecord tail', () => {
        const src = '(defrecord P [w] G (draw [obj c] (paint obj c)))';
        assert.deepEqual(occStarts(src, idx(src, 'obj', 1)), [
            idx(src, 'obj', 0),
            idx(src, 'obj', 1),
        ]);
    });

    it('leaves defrecord fields as struct keys, not locals', () => {
        // `w` is reached with `get` / destructuring, never as a local.
        const src = '(defrecord P [w] G (draw [obj] obj))';
        assert.equal(resolveLocalAt(src, idx(src, 'w', 0)), null);
    });

    it('binds reify and extend-type method parameters', () => {
        const reified = '(reify G (draw [obj] (paint obj)))';
        assert.deepEqual(occStarts(reified, idx(reified, 'obj', 1)), [
            idx(reified, 'obj', 0),
            idx(reified, 'obj', 1),
        ]);
        const extended = '(extend-type :string G (to-str [v] (up v)))';
        assert.deepEqual(occStarts(extended, idx(extended, 'v', 1)), [
            idx(extended, 'v', 0),
            idx(extended, 'v', 1),
        ]);
    });

    it('binds defmethod parameters after the dispatch value', () => {
        const src = '(defmethod area :circle [z] (* z z))';
        assert.deepEqual(occStarts(src, idx(src, 'z', 1)), [
            idx(src, 'z', 0),
            idx(src, 'z', 1),
            idx(src, 'z', 2),
        ]);
    });

    it('does not bind defprotocol signature parameters', () => {
        // A signature has no body, so its names are declarations, not locals —
        // binding them would report every one as an unused local.
        const src = '(defprotocol G (draw [obj c]))';
        assert.equal(resolveLocalAt(src, idx(src, 'obj', 0)), null);
        assert.deepEqual(findUnusedLocals(src), []);
    });

    it('leaves with-redefs targets as globals', () => {
        // `foo` is an existing var being temporarily rebound, not a new local:
        // renaming it must stay a workspace-wide rename.
        const src = '(with-redefs [foo (fn [] 1)] (foo))';
        assert.equal(resolveLocalAt(src, idx(src, 'foo', 1)), null);
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

    it('does not offer a letfn spec parameter outside that spec', () => {
        const src = '(letfn [(f [n] n) (g [m] m)] (f 1))';
        const inBody = localsInScopeAt(src, idx(src, '(f 1)') + 1);
        assert.deepEqual(inBody.sort(), ['f', 'g']);
    });
});

describe('phelScope.collectAllBindings', () => {
    it('collects nested bindings across every form', () => {
        const src = '(defn f [a] (let [b 1] (+ a b)))\n(fn [c] c)';
        const names = collectAllBindings(src)
            .map((b) => b.name)
            .sort();
        assert.deepEqual(names, ['a', 'b', 'c']);
    });

    it('tags parameters distinctly from let names', () => {
        const src = '(defn f [a] (let [b 1] b))';
        const all = collectAllBindings(src);
        assert.equal(all.find((b) => b.name === 'a')?.param, true);
        assert.ok(!all.find((b) => b.name === 'b')?.param);
    });
});

describe('phelScope.findUnusedLocals', () => {
    it('flags a let binding that is never read', () => {
        const src = '(let [used 1 dead 2] used)';
        const unused = findUnusedLocals(src).map((u) => u.name);
        assert.deepEqual(unused, ['dead']);
    });

    it('does not flag used bindings', () => {
        const src = '(let [x 1] (+ x x))';
        assert.deepEqual(findUnusedLocals(src), []);
    });

    it('exempts parameters and _-prefixed names', () => {
        const src = '(defn f [a] (let [_ignored 1] 42))';
        assert.deepEqual(findUnusedLocals(src), []);
    });
});

describe('phelScope caching', () => {
    // The analyzer memoises the parse and the per-name occurrence scan so a
    // semantic-tokens pass does not re-parse the document once per occurrence.
    // Both caches are keyed on the source string, so switching sources must
    // never serve a stale answer.
    it('does not serve results from a previous source', () => {
        const first = '(defn f [alpha] (+ alpha 1))';
        const second = '(defn g [beta] (+ beta 2))';

        const a1 = resolveLocalAt(first, idx(first, 'alpha', 1));
        assert.equal(a1?.name, 'alpha');

        const b = resolveLocalAt(second, idx(second, 'beta', 1));
        assert.equal(b?.name, 'beta');

        // Back to the first source: still correct, not a leftover from the second.
        const a2 = resolveLocalAt(first, idx(first, 'alpha', 1));
        assert.deepEqual(a2, a1);
    });

    it('returns the same occurrences whether or not the cache is warm', () => {
        const src = '(let [x 1] (+ x x))';
        const binding = resolveLocalAt(src, idx(src, 'x', 0));
        assert.ok(binding);
        const cold = localOccurrences(src, binding).map((o) => o.start);
        const warm = localOccurrences(src, binding).map((o) => o.start);
        assert.deepEqual(warm, cold);
        assert.equal(cold.length, 3);
    });
});
