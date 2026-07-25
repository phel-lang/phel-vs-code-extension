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

    it('leaves a PHP fully-qualified name as a symbol', () => {
        assertScoped('(catch \\Throwable e', '\\Throwable', 'meta.symbol.phel');
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

    it('scopes phel.router/compiled-router as a keyword', () => {
        assertScoped('(compiled-router routes)', 'compiled-router', 'keyword.control.phel');
    });
});
