// Pins the token shape seven providers share for `getWordRangeAtPosition`.
// It used to exist as seven byte-identical copies with no test at all.

import * as assert from 'node:assert/strict';
import { PHEL_SYMBOL_RE } from '../phelSymbolToken';

/** What the editor would treat as the word at `offset`. */
function wordAt(text: string, offset: number): string | null {
    const re = new RegExp(PHEL_SYMBOL_RE.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (offset >= start && offset < end) {
            return match[0];
        }
        if (start > offset) {
            return null;
        }
    }
    return null;
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
