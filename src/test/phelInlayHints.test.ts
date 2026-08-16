import * as assert from 'assert';
import { parameterHints, type ParameterHint } from '../phelInlayHints';

// A stand-in for the corpus: only these heads are functions, everything else
// (`let`, `fn`, `defn`, every macro) resolves to nothing, exactly as the
// provider's `kind: 'fn'` filter arranges.
const ARITIES: Record<string, string[]> = {
    assoc: ['(assoc ds key value)', '(assoc ds key value & more)'],
    'assoc-in': ['(assoc-in ds [k & ks] v)'],
    conj: ['(conj)', '(conj coll)', '(conj coll value)', '(conj coll value & more)'],
    greet: ['(greet name)'],
    inc: ['(inc x)'],
    map: ['(map f)', '(map f coll)', '(map f coll & more)'],
    push: ['(push xs item)'],
    str: ['(str & args)'],
    'take-while': ['(take-while pred coll)'],
};

function resolve(name: string): readonly string[] | undefined {
    return ARITIES[name];
}

function hints(src: string, range?: { start: number; end: number }): ParameterHint[] {
    return parameterHints(src, range ?? { start: 0, end: src.length }, resolve);
}

/**
 * The source with every label spliced in where the editor would draw it —
 * `(inc x: 1)`. Reads like the thing under test, so an assertion says what a
 * user would see rather than listing offsets.
 */
function render(src: string, range?: { start: number; end: number }): string {
    let out = '';
    let at = 0;
    for (const hint of hints(src, range)) {
        out += src.slice(at, hint.offset) + hint.label + ' ';
        at = hint.offset;
    }
    return out + src.slice(at);
}

describe('parameterHints', function () {
    it('labels every argument of a fixed arity', function () {
        assert.strictEqual(render('(assoc m :k v)'), '(assoc ds: m key: :k value: v)');
    });

    it('reports the offset of the argument the label sits before', function () {
        const src = '(inc 1)';
        assert.deepStrictEqual(hints(src), [
            { offset: src.indexOf('1'), label: 'x:', signature: '(inc x)' },
        ]);
    });

    it('picks the arity with the matching fixed argument count', function () {
        assert.strictEqual(render('(map inc xs)'), '(map f: inc coll: xs)');
        assert.strictEqual(render('(conj xs 1)'), '(conj coll: xs value: 1)');
    });

    it('falls back to the variadic arity when no fixed one matches', function () {
        // `(assoc ds key value & more)` — the labels stop at `&`.
        assert.strictEqual(render('(assoc m :a 1 :b 2)'), '(assoc ds: m key: :a value: 1 :b 2)');
    });

    it('never labels a variadic parameter', function () {
        assert.deepStrictEqual(hints('(str "a" "b")'), []);
    });

    it('emits nothing when the argument count matches no arity', function () {
        assert.deepStrictEqual(hints('(inc 1 2)'), []);
        assert.deepStrictEqual(hints('(take-while pred)'), []);
    });

    it('suppresses a label the argument already spells out', function () {
        assert.strictEqual(render('(assoc ds :k value)'), '(assoc ds key: :k value)');
    });

    it('labels a nested call as well as its parent', function () {
        assert.strictEqual(render('(inc (inc 1))'), '(inc x: (inc x: 1))');
    });

    it('labels the short-function body', function () {
        assert.strictEqual(render('#(assoc % :k v)'), '#(assoc ds: % key: :k value: v)');
    });

    it('shifts by one inside a thread-first macro', function () {
        assert.strictEqual(render('(-> m (assoc :k v))'), '(-> m (assoc key: :k value: v))');
        assert.strictEqual(
            render('(some-> m (assoc :k v))'),
            '(some-> m (assoc key: :k value: v))'
        );
        assert.strictEqual(render('(doto m (push 1))'), '(doto m (push item: 1))');
    });

    it('shifts only the step halves of a cond-> pair', function () {
        assert.strictEqual(
            render('(cond-> m pred (assoc :k v))'),
            '(cond-> m pred (assoc key: :k value: v))'
        );
    });

    it('leaves a thread-last macro alone', function () {
        assert.deepStrictEqual(hints('(->> xs (map f) (take-while pred))'), []);
        assert.deepStrictEqual(hints('(some->> xs (assoc m :k))'), []);
        assert.deepStrictEqual(hints('(cond->> xs pred (map f))'), []);
    });

    it('skips quoted and syntax-quoted data', function () {
        assert.deepStrictEqual(hints("'(assoc m :k v)"), []);
        assert.deepStrictEqual(hints('`(assoc m :k v)'), []);
        assert.deepStrictEqual(hints('`[(assoc m :k v)]'), []);
    });

    it('labels an unquoted form inside a syntax-quote', function () {
        assert.strictEqual(render('`(f ~(inc 1))'), '`(f ~(inc x: 1))');
    });

    it('skips a head shadowed by a local binding', function () {
        assert.deepStrictEqual(hints('(let [map (fn [x] x)] (map 1))'), []);
        assert.deepStrictEqual(hints('(fn [inc] (inc 1))'), []);
    });

    it('still labels a call whose head only shares a name with a local', function () {
        assert.strictEqual(render('(let [xs []] (inc 1))'), '(let [xs []] (inc x: 1))');
    });

    it('emits nothing for a head nothing resolves', function () {
        assert.deepStrictEqual(hints('(unknown-fn 1 2)'), []);
        assert.deepStrictEqual(hints('(:key m)'), []);
        assert.deepStrictEqual(hints('(let [a 1] a)'), []);
    });

    it('drops an arity whose parameters are destructured', function () {
        // `(assoc-in ds [k & ks] v)` splits into tokens no index can be read
        // off, so the call gets no labels rather than wrong ones.
        assert.deepStrictEqual(hints('(assoc-in m [:a :b] 1)'), []);
    });

    it('only reports arguments inside the requested range', function () {
        const src = '(inc 1)\n(assoc m :k v)';
        const second = src.indexOf('(assoc');
        assert.deepStrictEqual(
            hints(src, { start: second, end: src.length }).map((h) => h.label),
            ['ds:', 'key:', 'value:']
        );
        assert.deepStrictEqual(
            hints(src, { start: 0, end: src.indexOf('\n') }).map((h) => h.label),
            ['x:']
        );
    });

    it('carries the chosen arity as the tooltip', function () {
        assert.deepStrictEqual(
            hints('(map inc xs)').map((h) => h.signature),
            ['(map f coll)', '(map f coll)']
        );
    });
});
