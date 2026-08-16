// Pins the token shape seven providers share for `getWordRangeAtPosition`.
// It used to exist as seven byte-identical copies with no test at all.

import * as assert from 'node:assert/strict';
import { PHEL_SYMBOL_RE, symbolTokenAt } from '../phelSymbolToken';

/** What the editor would treat as the word at `offset`. */
function wordAt(text: string, offset: number): string | null {
    const token = symbolTokenAt(text, offset);
    return token ? text.slice(token.start, token.end) : null;
}

describe('PHEL_SYMBOL_RE', () => {
    const whole = (token: string) => {
        const m = PHEL_SYMBOL_RE.exec(token);
        return m && m[0] === token;
    };

    it('matches plain and punctuation-suffixed names', () => {
        for (const token of ['map', 'blank?', 'swap!', 'my-fn', 'a1', 'x#', "a'", "foo''"]) {
            assert.ok(whole(token), token);
        }
    });

    it('matches names that start with punctuation', () => {
        for (const token of ['->', '->>', 'some->>', '+', '-', '*ns*', '=', '<=', '%']) {
            assert.ok(whole(token), token);
        }
    });

    it('matches qualified symbols and keywords', () => {
        for (const token of ['str/join', 'php/->', 'phel.test/is', ':keyword', ':my.ns/name']) {
            assert.ok(whole(token), token);
        }
    });

    it('stops at the delimiters that end a token', () => {
        assert.equal(wordAt('(map inc xs)', 1), 'map');
        assert.equal(wordAt('[a b]', 1), 'a');
        assert.equal(wordAt('{:a 1}', 1), ':a');
        assert.equal(wordAt('(f "s")', 1), 'f');
        assert.equal(wordAt('`(x)', 2), 'x');
    });

    it('stops at a comma, which Phel reads as unquote rather than whitespace', () => {
        assert.equal(wordAt('a,b', 0), 'a');
    });

    it('splits the quote reader macro off the symbol it quotes', () => {
        // `'sym` is a quote followed by `sym`, so the word is `sym`.
        assert.equal(wordAt("'sym", 1), 'sym');
        assert.equal(wordAt("#'sym", 2), 'sym');
    });

    it('keeps a mid or trailing apostrophe inside the symbol', () => {
        // `a'` and `foo''` are single atoms to the lexer.
        assert.equal(wordAt("(a' 1)", 1), "a'");
        assert.equal(wordAt("(foo'' 1)", 1), "foo''");
    });

    it('keeps a gensym suffix in the token', () => {
        // Regression guard: the grammar treats a trailing `#` as part of the
        // symbol, and word selection has to agree.
        assert.equal(wordAt('(let [x# 1] x#)', 6), 'x#');
    });
});

describe('symbolTokenAt', () => {
    it('spans the whole token from the position it starts at', () => {
        // What the daemon reports for a reference: the start of the token, and
        // nothing about its length. `s/shout` has to come back whole, or a
        // rename would rewrite the first five characters of it.
        assert.deepEqual(symbolTokenAt('  (s/shout text))', 3), { start: 3, end: 10 });
    });

    it('spans it from anywhere inside it', () => {
        assert.deepEqual(symbolTokenAt('(shout text)', 4), { start: 1, end: 6 });
    });

    it('answers nothing for a column that is not in a token', () => {
        assert.equal(symbolTokenAt('(shout text)', 0), undefined);
        assert.equal(symbolTokenAt('   ', 1), undefined);
        assert.equal(symbolTokenAt('(shout text)', 99), undefined);
    });
});
