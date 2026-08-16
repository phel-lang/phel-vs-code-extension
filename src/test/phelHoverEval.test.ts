// What hover evaluation is allowed to send to a live runtime. Everything this
// rejects is either something whose value the reader can already see, or
// something the runtime would refuse — and the one rejection that really
// matters is the local, since a hover on `person` must not evaluate whatever
// global happens to share the name.

import * as assert from 'node:assert/strict';
import { hoverEvalCandidate } from '../phelHoverEval';

/** Candidate for the token containing the first occurrence of `needle`. */
function at(src: string, needle: string, shift = 0): string | null {
    const index = src.indexOf(needle);
    assert.notEqual(index, -1, `${JSON.stringify(needle)} is not in the source`);
    return hoverEvalCandidate(src, index + shift);
}

describe('hoverEvalCandidate', () => {
    it('takes the whole symbol, punctuation and all', () => {
        assert.equal(at('(add-item! xs)', 'add-item!'), 'add-item!');
        assert.equal(at('(blank? s)', 'blank?'), 'blank?');
        assert.equal(at('(-> x inc)', '->'), '->');
        assert.equal(at('*ns*', '*ns*'), '*ns*');
    });

    it('takes the symbol from anywhere inside it', () => {
        assert.equal(at('(add-item xs)', 'add-item', 4), 'add-item');
    });

    it('takes an alias-qualified symbol', () => {
        assert.equal(at('(str/join ", " xs)', 'str/join'), 'str/join');
        assert.equal(at('(phel.core/map inc xs)', 'phel.core/map'), 'phel.core/map');
    });

    it('rejects a local, which only exists in a stack frame', () => {
        const src = '(defn welcome [person]\n  (greet person))';
        assert.equal(at(src, 'person))'), null);
        // The declaration is a local too.
        assert.equal(at(src, 'person]'), null);
        // The function called with it is not.
        assert.equal(at(src, 'greet'), 'greet');
    });

    it('rejects a local that shares its name with a core function', () => {
        const src = '(defn f [count]\n  (inc count))';
        assert.equal(at(src, 'count))'), null);
    });

    it('rejects keywords, literals and numbers', () => {
        assert.equal(at('{:key 1}', ':key'), null);
        assert.equal(at('(= x nil)', 'nil'), null);
        assert.equal(at('(if true 1 2)', 'true'), null);
        assert.equal(at('(+ 42 1)', '42'), null);
        assert.equal(at('(+ -1.5 1)', '-1.5'), null);
        assert.equal(at('(bit-and 0x1f 3)', '0x1f'), null);
    });

    it('keeps the arithmetic functions, which are not numbers', () => {
        assert.equal(at('(+ 1 2)', '+'), '+');
        assert.equal(at('(- 1 2)', '-'), '-');
    });

    it('rejects special forms and php interop names', () => {
        assert.equal(at('(if x 1 2)', 'if'), null);
        assert.equal(at('(let [a 1] a)', 'let'), null);
        assert.equal(at('(php/aget arr 0)', 'php/aget'), null);
        assert.equal(at('(php/strlen "s")', 'php/strlen'), null);
    });

    it('rejects anything inside a string', () => {
        assert.equal(at('(println "call greet here")', 'greet'), null);
        // The escape does not end the string.
        assert.equal(at('(println "a \\" greet")', 'greet'), null);
        // A quote inside a string does not swallow the code after it.
        assert.equal(at('(str "a\\"b") (greet x)', 'greet'), 'greet');
    });

    it('rejects anything inside a line comment', () => {
        assert.equal(at('; call greet\n(inc 1)', 'greet'), null);
        assert.equal(at('; call greet\n(greet x)', '(greet', 1), 'greet');
    });

    it('returns null where there is no token', () => {
        assert.equal(hoverEvalCandidate('(map inc xs)', 4), null); // the space
        assert.equal(hoverEvalCandidate('(map inc xs)', 0), null); // the paren
        assert.equal(hoverEvalCandidate('', 0), null);
    });

    it('splits the quote reader macro off the symbol', () => {
        // `'sym` is a quote followed by `sym`; the token is the symbol.
        assert.equal(at("(quote 'sym)", 'sym)'), 'sym');
    });
});
