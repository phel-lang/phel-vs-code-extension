import * as assert from 'node:assert/strict';
import {
    barfBackward,
    barfForward,
    enclosingContainer,
    formAt,
    parseAll,
    pathAt,
    raise,
    readForm,
    slurpBackward,
    slurpForward,
    wrap,
    type PareditEdit,
} from '../phelParedit';

function apply(src: string, edit: PareditEdit | null): string {
    assert.ok(edit, 'expected edit, got null');
    return src.slice(0, edit.replaceStart) + edit.replacement + src.slice(edit.replaceEnd);
}

describe('phelParedit.parseAll', () => {
    it('parses top-level atoms', () => {
        const forms = parseAll('a b c');
        assert.deepEqual(
            forms.map((f) => [f.start, f.end, f.kind]),
            [
                [0, 1, 'atom'],
                [2, 3, 'atom'],
                [4, 5, 'atom'],
            ]
        );
    });

    it('parses lists with children', () => {
        const forms = parseAll('(a b)');
        assert.equal(forms.length, 1);
        assert.equal(forms[0].kind, 'list');
        assert.equal(forms[0].children.length, 2);
    });

    it('parses vectors and maps', () => {
        const forms = parseAll('[1 2] {:a 1}');
        assert.equal(forms[0].kind, 'vector');
        assert.equal(forms[1].kind, 'map');
    });

    it('parses anon-fn and set literals', () => {
        const forms = parseAll('#(+ % 1) #{1 2}');
        assert.equal(forms[0].kind, 'anon');
        assert.equal(forms[1].kind, 'set');
    });

    it('treats a string as a single form', () => {
        const forms = parseAll('"hello world"');
        assert.equal(forms.length, 1);
        assert.equal(forms[0].kind, 'string');
    });

    it('skips line comments', () => {
        const forms = parseAll('; ignored\nfoo');
        assert.equal(forms.length, 1);
        assert.equal(forms[0].start, 10);
    });

    it('skips block comments', () => {
        const forms = parseAll('#| ignored |# foo');
        assert.equal(forms.length, 1);
        assert.equal(forms[0].start, 14);
    });

    it('skips #_ discard form', () => {
        const forms = parseAll('#_(a b) c');
        assert.equal(forms.length, 1);
        assert.equal(forms[0].start, 8);
    });

    it('attaches reader prefixes to the following form', () => {
        const forms = parseAll("'foo");
        assert.equal(forms.length, 1);
        assert.equal(forms[0].start, 0);
        assert.equal(forms[0].end, 4);
        assert.equal(forms[0].kind, 'atom');
    });

    it('handles ~@ unquote-splice as a single prefix', () => {
        const forms = parseAll('~@x');
        assert.equal(forms.length, 1);
        assert.equal(forms[0].start, 0);
        assert.equal(forms[0].end, 3);
    });
});

describe('phelParedit.pathAt / formAt / enclosingContainer', () => {
    it('returns innermost form at offset', () => {
        const src = '(foo (bar baz))';
        const forms = parseAll(src);
        const path = pathAt(forms, 7); // inside "bar"
        assert.deepEqual(
            path.map((f) => f.kind),
            ['list', 'list', 'atom']
        );
    });

    it('returns null for offset in whitespace at top level', () => {
        const forms = parseAll(' x ');
        assert.equal(formAt(forms, 0), null);
    });

    it('finds enclosing container', () => {
        const src = '(a (b c))';
        const forms = parseAll(src);
        const c = enclosingContainer(forms, 5);
        assert.ok(c);
        assert.equal(c?.kind, 'list');
        assert.equal(c?.start, 3);
    });
});

describe('phelParedit.slurpForward', () => {
    it('absorbs the next sibling', () => {
        const src = '(a) b';
        assert.equal(apply(src, slurpForward(src, 1)), '(a b)');
    });

    it('inserts a space when there is none between', () => {
        const src = '(a)b';
        assert.equal(apply(src, slurpForward(src, 1)), '(a b)');
    });

    it('absorbs into a vector', () => {
        const src = '[a] b';
        assert.equal(apply(src, slurpForward(src, 1)), '[a b]');
    });

    it('returns null when there is nothing to slurp', () => {
        assert.equal(slurpForward('(a)', 1), null);
    });

    it('works on the inner list', () => {
        const src = '(foo (bar) baz)';
        assert.equal(apply(src, slurpForward(src, 6)), '(foo (bar baz))');
    });
});

describe('phelParedit.barfForward', () => {
    it('expels the last child', () => {
        const src = '(a b c)';
        assert.equal(apply(src, barfForward(src, 3)), '(a b) c');
    });

    it('works on a vector', () => {
        const src = '[a b c]';
        assert.equal(apply(src, barfForward(src, 3)), '[a b] c');
    });

    it('returns null on empty container', () => {
        assert.equal(barfForward('()', 1), null);
    });
});

describe('phelParedit.slurpBackward', () => {
    it('absorbs the previous sibling', () => {
        const src = 'a (b c)';
        assert.equal(apply(src, slurpBackward(src, 4)), '(a b c)');
    });

    it('inserts a space when there is none between', () => {
        const src = 'a(b c)';
        assert.equal(apply(src, slurpBackward(src, 3)), '(a b c)');
    });

    it('returns null when there is no prev sibling', () => {
        assert.equal(slurpBackward('(a b)', 1), null);
    });
});

describe('phelParedit.barfBackward', () => {
    it('expels the first child', () => {
        const src = '(a b c)';
        assert.equal(apply(src, barfBackward(src, 3)), 'a (b c)');
    });

    it('returns null on empty container', () => {
        assert.equal(barfBackward('()', 1), null);
    });
});

describe('phelParedit.raise', () => {
    it('replaces the parent with the form at the cursor', () => {
        const src = '(foo (bar baz))';
        // cursor on "bar" (offset 7)
        assert.equal(apply(src, raise(src, 7)), '(foo bar)');
    });

    it('returns null when there is no parent', () => {
        assert.equal(raise('foo', 1), null);
    });
});

describe('phelParedit.wrap', () => {
    it('wraps an atom with parens', () => {
        const src = 'foo';
        assert.equal(apply(src, wrap(src, 1, '(')), '(foo)');
    });

    it('wraps a list with brackets', () => {
        const src = '(a b)';
        assert.equal(apply(src, wrap(src, 0, '[')), '[(a b)]');
    });

    it('inserts empty pair when not on a form', () => {
        const src = '   ';
        assert.equal(apply(src, wrap(src, 1, '(')), ' ()  ');
    });
});

describe('phelParedit.readForm', () => {
    it('returns null at end of input', () => {
        assert.equal(readForm('   ', 0, 3), null);
    });

    it('reads through reader prefixes including # tag', () => {
        const f = readForm('#inst "2026-01-01"', 0, 18);
        assert.ok(f);
        assert.equal(f?.start, 0);
        assert.equal(f?.kind, 'string');
    });

    it('reads a namespaced tagged literal as one form', () => {
        const src = '#my.app/Person {:name "Ada"}';
        const f = readForm(src, 0, src.length);
        assert.ok(f);
        assert.equal(f?.start, 0);
        assert.equal(f?.end, src.length);
        assert.equal(f?.kind, 'map');
    });

    it('reads a regex literal as a single string form', () => {
        const src = '#"^\\d+$"';
        const f = readForm(src, 0, src.length);
        assert.ok(f);
        assert.equal(f?.start, 0);
        assert.equal(f?.end, src.length);
        assert.equal(f?.kind, 'string');
    });

    it('does not let a regex literal swallow the rest of a list', () => {
        const forms = parseAll('(def re #"a\\"b") (def x 1)');
        assert.equal(forms.length, 2);
        assert.equal(forms[0].children.length, 3);
        assert.equal(forms[0].children[2].kind, 'string');
    });

    it('reads a char literal that is an open paren', () => {
        const forms = parseAll('[\\( \\space \\A]');
        assert.equal(forms.length, 1);
        assert.equal(forms[0].children.length, 3);
        assert.deepEqual(
            forms[0].children.map((c) => c.kind),
            ['char', 'char', 'char']
        );
    });
});
