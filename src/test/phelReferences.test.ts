import * as assert from 'node:assert/strict';
import {
    countSymbolTokens,
    findOccurrences,
    findPrefixedOccurrences,
    findQualifiedOccurrences,
    firstSymbolTokenOffsets,
    isValidSymbolName,
} from '../phelReferences';

function offsets(occ: ReturnType<typeof findOccurrences>): number[] {
    return occ.map((o) => o.start);
}

describe('phelReferences.findOccurrences', () => {
    it('finds standalone occurrences', () => {
        const src = '(foo bar foo)';
        assert.deepEqual(offsets(findOccurrences(src, 'foo')), [1, 9]);
    });

    it('does not match substrings', () => {
        const src = '(foobar foo-bar foo)';
        assert.deepEqual(offsets(findOccurrences(src, 'foo')), [16]);
    });

    it('skips strings', () => {
        const src = '(foo "foo" foo)';
        assert.deepEqual(offsets(findOccurrences(src, 'foo')), [1, 11]);
    });

    it('skips line comments', () => {
        const src = '(foo)\n; foo here\n(foo)';
        assert.deepEqual(offsets(findOccurrences(src, 'foo')), [1, 18]);
    });

    it('skips block comments', () => {
        const src = '(foo) #| foo |# (foo)';
        assert.deepEqual(offsets(findOccurrences(src, 'foo')), [1, 17]);
    });

    it('skips char literals', () => {
        const src = '(foo \\f foo)';
        assert.deepEqual(offsets(findOccurrences(src, 'foo')), [1, 8]);
    });

    it('matches at end of file', () => {
        const src = '(let [x foo])\nfoo';
        assert.deepEqual(offsets(findOccurrences(src, 'foo')), [8, 14]);
    });

    it('matches symbols with special chars', () => {
        const src = '(my-fn? a) (my-fn? b)';
        assert.deepEqual(offsets(findOccurrences(src, 'my-fn?')), [1, 12]);
    });

    it('returns empty for empty name', () => {
        assert.deepEqual(findOccurrences('foo', ''), []);
    });
});

describe('phelReferences.findQualifiedOccurrences', () => {
    it('finds a symbol qualified by the namespace', () => {
        const src = '(str/join ", " (str/split s))';
        assert.deepEqual(offsets(findQualifiedOccurrences(src, 'str')), [1, 16]);
    });

    it('does not match the bare token findOccurrences is for', () => {
        const src = '(def str 1)';
        assert.deepEqual(findQualifiedOccurrences(src, 'str'), []);
        assert.deepEqual(offsets(findOccurrences(src, 'str')), [5]);
    });

    it('does not match a slash that ends the token', () => {
        // `str/` is not a symbol; the name after the slash has to be there.
        assert.deepEqual(findQualifiedOccurrences('(str/ 1)', 'str'), []);
    });

    it('does not match a namespace that is only a suffix of another', () => {
        assert.deepEqual(findQualifiedOccurrences('(my.str/join xs)', 'str'), []);
    });

    it('skips strings and comments, as the unqualified scan does', () => {
        const src = '(str/join x) "str/join" ; str/join\n';
        assert.deepEqual(offsets(findQualifiedOccurrences(src, 'str')), [1]);
    });

    it('returns empty for an empty namespace', () => {
        assert.deepEqual(findQualifiedOccurrences('(str/join x)', ''), []);
    });
});

describe('phelReferences.countSymbolTokens', () => {
    it('counts each token once per occurrence', () => {
        const counts = countSymbolTokens('(foo bar foo)');
        assert.equal(counts.get('foo'), 2);
        assert.equal(counts.get('bar'), 1);
    });

    it('counts a qualified token under both its spellings', () => {
        // A scan for `shout` cannot match inside `s/shout`, so the bare tally is
        // the only thing that makes an alias-qualified call countable.
        const counts = countSymbolTokens('(s/shout "hi")');
        assert.equal(counts.get('s/shout'), 1);
        assert.equal(counts.get('shout'), 1);
    });

    it('skips strings, comments, and char literals, like findOccurrences', () => {
        const src = '(foo "foo" \\f)\n; foo\n#| foo |#\n(foo)';
        assert.equal(countSymbolTokens(src).get('foo'), 2);
    });

    it('keeps a trailing apostrophe inside the token it belongs to', () => {
        const counts = countSymbolTokens("(+ a' a)");
        assert.equal(counts.get("a'"), 1);
        assert.equal(counts.get('a'), 1);
    });

    it('counts nothing for a name that is only part of another token', () => {
        assert.equal(countSymbolTokens('(foobar foo-bar)').get('foo'), undefined);
    });

    it('leaves a token that is only a slash alone', () => {
        const counts = countSymbolTokens('(/ 6 2)');
        assert.equal(counts.get('/'), 1);
        assert.equal(counts.get(''), undefined);
    });
});

describe('phelReferences.findPrefixedOccurrences', () => {
    it('spans the whole token and the name half separately', () => {
        const src = '(defn loud [t]\n  (s/shout t))';
        const [occ] = findPrefixedOccurrences(src, 'shout');

        assert.equal(occ.prefix, 's');
        assert.equal(src.slice(occ.start, occ.end), 's/shout');
        // What a rename replaces: `s/shout` becomes `s/yell`, not `yell`.
        assert.equal(src.slice(occ.nameStart, occ.end), 'shout');
    });

    it('finds a namespace written out in full as readily as an alias', () => {
        const occurrences = findPrefixedOccurrences('(demo.strings/shout "hi")', 'shout');
        assert.deepEqual(
            occurrences.map((o) => o.prefix),
            ['demo.strings']
        );
    });

    it('ignores the bare name and a name that is merely a suffix', () => {
        assert.deepEqual(findPrefixedOccurrences('(shout "hi") (s/shouting)', 'shout'), []);
    });

    it('skips strings and comments', () => {
        assert.deepEqual(findPrefixedOccurrences('"s/shout" ; s/shout', 'shout'), []);
    });
});

describe('phelReferences.firstSymbolTokenOffsets', () => {
    it('records where each distinct token is first written', () => {
        const src = '(defn greet [n] (greet n))';
        const offsets = firstSymbolTokenOffsets(src);

        assert.equal(offsets.get('defn'), 1);
        assert.equal(offsets.get('greet'), src.indexOf('greet'));
        assert.equal(offsets.get('n'), src.indexOf('[n]') + 1);
    });
});

describe('phelReferences.isValidSymbolName', () => {
    it('accepts plain symbols', () => {
        assert.equal(isValidSymbolName('foo'), true);
        assert.equal(isValidSymbolName('my-fn?'), true);
        assert.equal(isValidSymbolName('+'), true);
    });

    it('rejects empty names', () => {
        assert.equal(isValidSymbolName(''), false);
    });

    it('rejects names with delimiters', () => {
        assert.equal(isValidSymbolName('foo bar'), false);
        assert.equal(isValidSymbolName('foo)'), false);
        assert.equal(isValidSymbolName('"foo"'), false);
    });
});

describe('phelReferences apostrophe handling', () => {
    it('does not match a bare name inside a prime-suffixed symbol', () => {
        // Regression: `'` used to terminate a symbol on both sides, so the
        // leading `a` of `a'` looked like a whole token and renaming `a`
        // rewrote part of `a'`.
        const src = "(def a' 41)\n(def a 1)\n(+ a' a)";
        assert.deepEqual(offsets(findOccurrences(src, 'a')), [
            src.indexOf('(def a 1)') + 5,
            src.lastIndexOf('a'),
        ]);
    });

    it('finds every occurrence of a prime-suffixed symbol', () => {
        const src = "(def a' 41)\n(def a 1)\n(+ a' a)";
        assert.deepEqual(offsets(findOccurrences(src, "a'")), [5, src.indexOf("a'", 12)]);
    });

    it('still finds a symbol that a quote reader macro precedes', () => {
        const src = "(def sym 1)\n'sym";
        assert.deepEqual(offsets(findOccurrences(src, 'sym')), [5, src.lastIndexOf('sym')]);
    });

    it('accepts a trailing apostrophe as a rename target but not a leading one', () => {
        assert.equal(isValidSymbolName("a'"), true);
        assert.equal(isValidSymbolName("foo''"), true);
        assert.equal(isValidSymbolName("'sym"), false);
    });
});
