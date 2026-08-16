// Grammar regression tests: tokenize snippets against
// `syntaxes/phel.tmLanguage.json` with the same engine VS Code ships
// (vscode-textmate + vscode-oniguruma) and assert the resulting scopes.
//
// `npm run tokenize` prints the same information for a whole sample file;
// these tests pin the literal forms the Phel lexer accepts so a grammar edit
// cannot silently drop one.

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Registry, parseRawGrammar, INITIAL, type IGrammar } from 'vscode-textmate';
import * as oniguruma from 'vscode-oniguruma';

const repoRoot = join(__dirname, '..', '..');

interface Token {
    text: string;
    scopes: string[];
}

let grammar: IGrammar;

async function loadGrammar(): Promise<IGrammar> {
    const wasmPath = require.resolve('vscode-oniguruma/release/onig.wasm');
    await oniguruma.loadWASM(readFileSync(wasmPath).buffer as ArrayBuffer);

    const grammarPath = join(repoRoot, 'syntaxes', 'phel.tmLanguage.json');
    const grammarRaw = readFileSync(grammarPath, 'utf-8');
    const registry = new Registry({
        onigLib: Promise.resolve({
            createOnigScanner: (sources: string[]) => new oniguruma.OnigScanner(sources),
            createOnigString: (str: string) => new oniguruma.OnigString(str),
        }),
        loadGrammar: () => Promise.resolve(parseRawGrammar(grammarRaw, grammarPath)),
    });
    const loaded = await registry.loadGrammar('source.phel');
    assert.ok(loaded, 'failed to load source.phel grammar');
    return loaded;
}

function tokenize(line: string): Token[] {
    const result = grammar.tokenizeLine(line, INITIAL);
    return result.tokens.map((t) => ({
        text: line.slice(t.startIndex, t.endIndex),
        scopes: t.scopes,
    }));
}

/** Scopes of the first token whose text is exactly `text`. */
function scopesOf(line: string, text: string): string[] {
    const token = tokenize(line).find((t) => t.text === text);
    assert.ok(token, `no token with text ${JSON.stringify(text)} in ${JSON.stringify(line)}`);
    return token.scopes;
}

function assertScoped(line: string, text: string, scope: string): void {
    const scopes = scopesOf(line, text);
    assert.ok(
        scopes.includes(scope),
        `expected ${JSON.stringify(text)} to carry ${scope}, got ${scopes.join(' ')}`
    );
}

describe('phel.tmLanguage numeric literals', () => {
    before(async () => {
        grammar = await loadGrammar();
    });

    const cases: [string, string, string][] = [
        ['(def x 42)', '42', 'constant.numeric.decimal.phel'],
        ['(def x +7)', '+7', 'constant.numeric.decimal.phel'],
        ['(def x 1_000)', '1_000', 'constant.numeric.decimal.phel'],
        ['(def x 0xff)', '0xff', 'constant.numeric.hex.phel'],
        ['(def x 0b1010)', '0b1010', 'constant.numeric.binary.phel'],
        ['(def x 017)', '017', 'constant.numeric.octal.phel'],
        ['(def x 16rFF)', '16rFF', 'constant.numeric.radix.phel'],
        ['(def x 2r1010)', '2r1010', 'constant.numeric.radix.phel'],
        ['(def x 123N)', '123N', 'constant.numeric.bigint.phel'],
        ['(def x 1.5M)', '1.5M', 'constant.numeric.bigdecimal.phel'],
        ['(def x 3/4)', '3/4', 'constant.numeric.ratio.phel'],
        ['(def x -3/4)', '-3/4', 'constant.numeric.ratio.phel'],
        ['(def x ##Inf)', '##Inf', 'constant.language.symbolic-number.phel'],
        ['(def x ##-Inf)', '##-Inf', 'constant.language.symbolic-number.phel'],
        ['(def x ##NaN)', '##NaN', 'constant.language.symbolic-number.phel'],
    ];

    for (const [line, text, scope] of cases) {
        it(`scopes ${text} as ${scope}`, () => {
            assertScoped(line, text, scope);
        });
    }
});

describe('phel.tmLanguage character literals', () => {
    before(async () => {
        grammar = await loadGrammar();
    });

    for (const text of ['\\A', '\\1', '\\(', '\\space', '\\newline', '\\u00e9', '\\o101']) {
        it(`scopes ${text} as a character`, () => {
            assertScoped(`(def c ${text})`, text, 'constant.character.phel');
        });
    }

    it('reads a PHP fully-qualified name as a class, not a character literal', () => {
        // The lexer's lookahead is what keeps `\T` from being the character
        // `T`; the leading marker then makes the name unambiguously a PHP
        // class, which is stronger than the bare symbol it used to scope as.
        assertScoped('(catch \\Throwable e', 'Throwable', 'support.class.phel');
        const tokens = tokenize('(catch \\Throwable e');
        assert.ok(
            !tokens.some((t) => t.scopes.some((s) => s.startsWith('constant.character'))),
            'a class name must not be chewed as a character literal'
        );
    });
});

describe('phel.tmLanguage reader syntax', () => {
    before(async () => {
        grammar = await loadGrammar();
    });

    it('scopes a regex literal as a regexp string', () => {
        assertScoped('(def re #"^\\d+$")', '^', 'string.regexp.phel');
    });

    it('keeps a gensym suffix inside the symbol instead of starting a comment', () => {
        const tokens = tokenize('(let [x# 1] x#)');
        assertScoped('(let [x# 1] x#)', 'x#', 'meta.symbol.phel');
        assert.ok(
            !tokens.some((t) => t.scopes.some((s) => s.startsWith('comment'))),
            'gensym must not open a comment'
        );
    });

    it('scopes a namespaced tagged literal name', () => {
        assertScoped('#my.app/Person {:a 1}', 'my.app/Person', 'storage.type.tagged.phel');
    });

    it('still scopes a bare-# line comment', () => {
        assertScoped('# legacy comment', '# legacy comment'.slice(1), 'comment.line.phel');
    });

    it('keeps a mid or trailing apostrophe inside the symbol', () => {
        // `a'` and `foo''` are single atoms to the lexer; the apostrophe must
        // not scope as the quote reader macro.
        assertScoped("(def a' 41)", "a'", 'meta.symbol.phel');
        assertScoped("(def foo'' 1)", "foo''", 'meta.symbol.phel');
    });

    it('still scopes a leading apostrophe as the quote reader macro', () => {
        const tokens = tokenize("('quoted)");
        const quote = tokens.find((t) => t.text === "'");
        assert.ok(quote, 'expected a standalone quote token');
        assert.ok(quote.scopes.includes('punctuation.other.phel'));
        assertScoped("('quoted)", 'quoted', 'meta.symbol.phel');
    });

    it('scopes phel.router/compiled-router as a keyword', () => {
        assertScoped('(compiled-router routes)', 'compiled-router', 'keyword.control.phel');
    });
});

describe('phel.tmLanguage Clojure-style interop', () => {
    before(async () => {
        grammar = await loadGrammar();
    });

    it('scopes an instance method call', () => {
        assertScoped('(.format d "Y")', '.', 'punctuation.accessor.phel');
        assertScoped('(.format d "Y")', 'format', 'entity.name.function.interop.phel');
    });

    it('scopes a value member read', () => {
        assertScoped('(.-y point)', '.-', 'punctuation.accessor.phel');
        assertScoped('(.-y point)', 'y', 'variable.other.property.phel');
    });

    it('does not read a field as a method named -field', () => {
        const tokens = tokenize('(.-y point)');
        assert.ok(
            !tokens.some((t) => t.text === '-y'),
            'the `.-` accessor must be one token, not `.` plus `-y`'
        );
    });

    it('scopes a static call and a class constant', () => {
        assertScoped('(DateTime/createFromFormat "Y" s)', 'DateTime', 'support.class.phel');
        assertScoped(
            '(DateTime/createFromFormat "Y" s)',
            'createFromFormat',
            'entity.name.function.interop.phel'
        );
        assertScoped('(def m PDO/ATTR_ERRMODE)', 'PDO', 'support.class.phel');
        assertScoped('(def m PDO/ATTR_ERRMODE)', 'ATTR_ERRMODE', 'constant.other.class.phel');
    });

    it('scopes a static property read, which carries the sigil', () => {
        assertScoped(
            '(def n Counter/$instances)',
            '$instances',
            'variable.other.property.static.phel'
        );
    });

    it('scopes a method taken as a value', () => {
        assertScoped('(map Registry/.render xs)', 'Registry', 'support.class.phel');
        assertScoped('(map Registry/.render xs)', 'render', 'entity.name.function.interop.phel');
    });

    it('scopes the trailing-dot constructor', () => {
        assertScoped('(DateTime. "2024-03-10")', 'DateTime', 'support.class.phel');
    });

    it('scopes a dotted namespaced class as one name', () => {
        assertScoped(
            '(def s Symfony.Component.Console.Command.Command/SUCCESS)',
            'Symfony.Component.Console.Command.Command',
            'support.class.phel'
        );
    });

    it('leaves a lowercase namespace alias alone', () => {
        // `str/join` is a Phel alias, not a PHP class: only an upper-case first
        // segment marks a class, exactly as the analyzer decides it.
        assertScoped('(str/join ", " xs)', 'str/join', 'meta.symbol.phel');
        assertScoped('(phel.string/blank? s)', 'phel.string/blank?', 'meta.symbol.phel');
    });

    it('leaves a bare capitalised symbol alone', () => {
        // A `defstruct` / `definterface` name looks the same as a class, so
        // only member access or the explicit `\` marker is treated as interop.
        assertScoped('(defstruct Point [x y])', 'Point', 'meta.symbol.phel');
    });

    it('keeps a leading decimal a number rather than a member', () => {
        // The decimal rule splits `.5` into its own two tokens (the period is
        // captured separately), so this asserts on the period: it must stay
        // numeric and must not pick up the interop accessor scope.
        const dot = tokenize('(def x .5)').find((t) => t.text === '.');
        assert.ok(dot, 'expected a period token');
        assert.ok(dot.scopes.includes('constant.numeric.decimal.phel'));
        assert.ok(!dot.scopes.includes('punctuation.accessor.phel'));
    });

    it('still scopes the php/ interop family as keywords', () => {
        assertScoped('(php/aget arr 0)', 'php/aget', 'keyword.control.phel');
        assertScoped('(php/$_SERVER "REQUEST_URI")', 'php/$_SERVER', 'keyword.control.phel');
    });
});

describe('phel.tmLanguage comma handling', () => {
    before(async () => {
        grammar = await loadGrammar();
    });

    it('scopes a comma as a separator, not as unquote', () => {
        // `,` and `,@` lost their reader meaning before 1.0; a comma is plain
        // whitespace, so `` `(foo ,x) `` quotes `x` instead of unquoting it.
        assertScoped('{:a 1, :b 2}', ',', 'punctuation.separator.comma.phel');
        const tokens = tokenize('`(list ,x ,@xs)');
        assert.ok(
            !tokens.some((t) => t.scopes.some((s) => s.includes('unquote'))),
            'a comma must not carry an unquote scope'
        );
    });

    it('still scopes ~ and ~@ as unquote', () => {
        assertScoped('`(list ~x)', '~', 'punctuation.other.phel');
        assertScoped('`(list ~@xs)', '~@', 'punctuation.other.unquote-splicing.phel');
    });
});

describe('phel.tmLanguage 0.50 forms', () => {
    before(async () => {
        grammar = await loadGrammar();
    });

    it('scopes defbench as a keyword', () => {
        assertScoped('(defbench bench-sum (+ 1 1))', 'defbench', 'keyword.control.phel');
    });

    it('scopes set! as a keyword', () => {
        assertScoped('(set! (.-y p) 1)', 'set!', 'keyword.control.phel');
    });

    it('scopes the phel.test isolation macros as keywords', () => {
        assertScoped('(with-isolated-stats (run))', 'with-isolated-stats', 'keyword.control.phel');
        assertScoped(
            '(with-isolated-reporters [] (run))',
            'with-isolated-reporters',
            'keyword.control.phel'
        );
    });
});
