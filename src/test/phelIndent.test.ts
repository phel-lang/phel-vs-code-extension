// The shapes below are the fixtures of phel-lang's own
// `tests/php/Integration/Formatter/FormatterFacadeTest.php`, pasted as the
// formatter writes them. Asking `indentationAt` for every line of an already
// formatted file must return the indentation it already has: that fixed point
// is the whole contract, because anything else is a line the next save moves.

import * as assert from 'node:assert/strict';
import { BLOCK_INDENT_HEADS, INNER_INDENT_HEADS, indentationAt, reindentLine } from '../phelIndent';

/** `[what phel-lang calls it, the formatted lines]`. */
const FORMATTED: [string, string[]][] = [
    ['a list with two arguments', ['(x a', '   b', '   c)']],
    ['a list with one argument', ['(x', ' b', ' c)']],
    ['an if block', ['(if (= x 1)', '  true', '  false)']],
    ['a do block', ['(do', '  (foo)', '  (bar))']],
    ['a do block whose body starts on the head line', ['(do (foo)', '    (bar))']],
    ['a case block', ['(case (+ 7 5)', '  3  :small', '  12 :big)']],
    [
        'aligned cond pairs',
        [
            '(cond',
            '  won?            :won',
            '  (board-full? b) :draw',
            '  :else           :playing)',
        ],
    ],
    [
        'aligned let bindings',
        ['(let [x      1', '      longer 2', '      a      3]', '  (+ x longer a))'],
    ],
    ['aligned if-let bindings', ['(if-let [x      1', '         longer 2]', '  true', '  false)']],
    ['for bindings, which are not pairs', ['(for [x :in xs', '      y :in ys]', '  body)']],
    ['a map literal', ['{:a 1', ' :bbbb 2}']],
    ['a plain vector', ['[a 1', ' bb 22]']],
    ['a def block', ['(def foo', '  1)']],
    ['a defn block', ['(defn foo [x]', '  (+ x 1))']],
    ['a defn block with the arguments on their own line', ['(defn foo', '  [x]', '  (+ x 1))']],
    ['a defbench block', ['(defbench bench-sum', '  {:revs 200}', '  (reduce + 0 ints))']],
    ['a map nested in a let binding', ['(let [a {:x 1', '         :y 2}]', '  (:x a))']],
    ['a fn nested in a def', ['(def foo', '  (fn [bar]', '    (inc bar)))']],
    ['a doseq body', ['(doseq [x coll]', '  (println x))']],
    ['defprotocol methods', ['(defprotocol Speakable', '  (speak [this]))']],
    ['a reify body', ['(reify Speakable', '  (speak [this] "hi"))']],
    ['a lazy-seq body', ['(lazy-seq', '  (cons 1 nil))']],
    ['a defstruct body', ['(defstruct point', '  [x y])']],
    [
        'a cond with a multi-line key (phel #1986)',
        [
            '(cond',
            '  (some (fn [k] (contains? query k)) ks) :set-op',
            '  (and (contains? query :values)',
            '       (not (contains? query :select))) :values-only',
            '  :else :select)',
        ],
    ],
    [
        'a case with a multi-line key (phel #1986)',
        ['(case x', '  (foo', '   bar) :first', '  :baz :second', '  :default)'],
    ],
    // Shapes phel has no fixture for, taken from what `phel format` printed for
    // them: the threading macros, `ns`, `try`, `deftest`, and the two readers
    // that open two characters wide.
    ['a threading macro', ['(-> x', '    (inc)', '    (str "!"))']],
    ['an ns form', ['(ns demo.b', '  (:require phel\\str :as s))']],
    [
        'try with catch and finally',
        ['(try', '  (foo)', '  (catch \\Exception e', '    (bar e))', '  (finally', '    (baz)))'],
    ],
    ['a deftest body', ['(deftest test-thing', '  (is (= 1 1)))']],
    ['a short fn literal', ['(map #(inc $)', '     xs)']],
    ['a set literal', ['#{1 2', '  3}']],
    // Metadata belongs to the form behind it, so this arity has one argument
    // and its body aligns under `^` - phel's own `core/strings.phel` shape.
    [
        'an arity under a return-type hint',
        ['(defn str', '  ([] "")', '  (^string [x y]', '   (php/. x y)))'],
    ],
];

describe('phelIndent.indentationAt', () => {
    for (const [name, lines] of FORMATTED) {
        it(`leaves ${name} where \`phel format\` put it`, () => {
            const src = lines.join('\n');
            assert.deepEqual(indentsOf(src), lines.map(leadingWidth));
        });
    }

    it('indents the body of a form that is still being typed', () => {
        // No closing bracket anywhere: the buffer a user is halfway through.
        const src = '(defn f []\n';
        assert.equal(indentationAt(src, src.length), 2);
    });

    it('indents the argument of a call that is still being typed', () => {
        const src = '(defn f []\n  (foo\n';
        assert.equal(indentationAt(src, src.length), 3);
    });

    it('puts a top-level line at column zero', () => {
        assert.equal(indentationAt('(def a 1)\n', 10), 0);
    });

    it('indents an empty line inside a vector under the first element', () => {
        const src = '(defn f [x]\n  [1\n';
        assert.equal(indentationAt(src, src.length), 3);
    });

    it('indents a comment line like the code it sits among', () => {
        // `phel format` never re-indents a comment line, it keeps whatever
        // indentation the comment has - so giving a fresh one the structural
        // indent is a choice the formatter then preserves.
        const src = '(defn f [x]\n  ; note\n';
        assert.equal(indentationAt(src, 12), 2);
    });

    it('leaves the inside of a multi-line string alone', () => {
        const src = '(defn f\n  "Doc line one\ncontinues here."\n  [x]\n  x)';
        assert.equal(indentationAt(src, src.indexOf('continues')), null);
    });

    it('reads a qualified head the way the formatter does, namespace dropped', () => {
        // `Symbol::create` splits on the first `/`, and the indenters match on
        // the name alone, so `demo/let` really does indent like `let`.
        assert.equal(indentationAt('(demo/let [x 1]\n  x)', 16), 2);
    });

    it('does not treat a quoted head as a head', () => {
        // A reader prefix wraps the symbol in another node, which the
        // formatter's head match misses; what is left is the plain list rule.
        assert.equal(indentationAt("('do (foo)\n", 11), 5);
    });
});

describe('phelIndent.reindentLine', () => {
    it('replaces the leading whitespace of a line that sits wrong', () => {
        const src = '(defn f []\n      (foo))';
        assert.deepEqual(reindentLine(src, 11), { start: 11, end: 17, text: '  ' });
    });

    it('answers null when the line is already where it belongs', () => {
        assert.equal(reindentLine('(defn f []\n  (foo))', 11), null);
    });

    it('answers null inside a multi-line string', () => {
        const src = '(def s "one\n  two")';
        assert.equal(reindentLine(src, 12), null);
    });

    it('indents a closing bracket that was typed on its own line', () => {
        const src = '(defn f []\n  (foo\n)';
        assert.deepEqual(reindentLine(src, 18), { start: 18, end: 18, text: '   ' });
    });
});

describe('phelIndent head tables', () => {
    // Pinned so that regenerating the corpus against a newer phel-lang, which
    // is when these lists change, has to be reviewed rather than assumed.
    // Source: `src/php/Formatter/FormatterFactory.php` in phel-lang 0.50.
    it('mirrors INNER_INDENT_SYMBOLS', () => {
        assert.equal(
            [...INNER_INDENT_HEADS].sort().join(' '),
            'def def- defbench defenum defexception definterface defmacro defmacro- defmethod ' +
                'defmulti defn defn- defonce defprotocol defrecord defstruct deftest fn reify'
        );
    });

    it('mirrors BLOCK_INDENT_SYMBOLS with the argument counts', () => {
        assert.equal(
            [...BLOCK_INDENT_HEADS]
                .map(([head, fixedArgs]) => `${head}:${fixedArgs}`)
                .sort()
                .join(' '),
            'binding:1 case:1 catch:2 cond:0 condp:2 delay:0 do:0 dofor:1 doseq:1 ' +
                'dotimes:1 extend-protocol:1 extend-type:1 finally:0 for:1 foreach:1 ' +
                'if-let:1 if-not:1 if-some:1 if:1 lazy-seq:0 let:1 letfn:1 loop:1 ns:1 ' +
                'try:0 when-first:1 when-let:1 when-not:1 when-some:1 when:1 ' +
                'with-bindings:1 with-isolated-reporters:1 with-isolated-stats:0 ' +
                'with-open:1 with-output-buffer:0 with-redefs:1'
        );
    });
});

/** The indentation `indentationAt` asks for, line by line. */
function indentsOf(src: string): (number | null)[] {
    const indents: (number | null)[] = [];
    let lineStart = 0;
    for (;;) {
        indents.push(indentationAt(src, lineStart));
        const newline = src.indexOf('\n', lineStart);
        if (newline < 0) {
            return indents;
        }
        lineStart = newline + 1;
    }
}

function leadingWidth(line: string): number {
    return line.length - line.trimStart().length;
}
