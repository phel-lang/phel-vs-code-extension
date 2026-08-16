// Guards `snippets/phel.code-snippets`: the file is hand-written, so a typo in
// a prefix or a form that upstream removed would ship silently. Every prefix is
// checked against the generated symbol corpus plus the hand-curated special
// forms, which is the same surface completion offers.

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SPECIAL_FORMS, MACROS, CORE_FNS } from '../phelCoreSymbols';
import { PHEL_DOCS } from '../phelCoreDocs';

interface Snippet {
    prefix: string;
    body: string[];
    description: string;
}

const snippets: Record<string, Snippet> = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'snippets', 'phel.code-snippets'), 'utf-8')
);

const entries = Object.entries(snippets);

describe('phel snippets', () => {
    it('is not empty', () => {
        assert.ok(entries.length > 0);
    });

    it('gives every snippet a prefix, a non-empty body, and a description', () => {
        for (const [name, snip] of entries) {
            assert.equal(typeof snip.prefix, 'string', `${name}: prefix`);
            assert.ok(snip.prefix.length > 0, `${name}: empty prefix`);
            assert.ok(Array.isArray(snip.body) && snip.body.length > 0, `${name}: body`);
            assert.ok(
                typeof snip.description === 'string' && snip.description.length > 0,
                `${name}: description`
            );
        }
    });

    it('uses a distinct prefix per snippet', () => {
        const seen = new Map<string, string>();
        for (const [name, snip] of entries) {
            const clash = seen.get(snip.prefix);
            assert.equal(
                clash,
                undefined,
                `prefix ${snip.prefix} used by both ${clash} and ${name}`
            );
            seen.set(snip.prefix, name);
        }
    });

    it('only offers prefixes that exist in the Phel language surface', () => {
        const known = new Set<string>([
            ...SPECIAL_FORMS,
            ...MACROS,
            ...CORE_FNS,
            ...PHEL_DOCS.filter((d) => !d.private).map((d) => d.name),
        ]);
        // The Clojure-style interop shorthands are reader syntax rather than
        // symbols, so no corpus entry backs `.method` / `.-field`. They are
        // still frozen language surface — see the interop table in phel-lang's
        // `docs/spec/language-surface.md`.
        const isInteropShorthand = (prefix: string): boolean => /^\.-?[A-Za-z]/.test(prefix);
        const unknown = entries
            .map(([, snip]) => snip.prefix)
            .filter((prefix) => !known.has(prefix) && !isInteropShorthand(prefix));
        assert.deepEqual(unknown, [], `snippet prefixes with no matching Phel form: ${unknown}`);
    });

    it('balances brackets in every body', () => {
        const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
        for (const [name, snip] of entries) {
            const text = snip.body.join('\n');
            const stack: string[] = [];
            let inString = false;
            for (let i = 0; i < text.length; i++) {
                const c = text[i];
                if (c === '\\') {
                    i++;
                    continue;
                }
                if (c === '"') {
                    inString = !inString;
                    continue;
                }
                if (inString) {
                    continue;
                }
                // `${1:...}` placeholders carry their own braces.
                if (c === '$' && text[i + 1] === '{') {
                    stack.push('${');
                    i++;
                    continue;
                }
                if ('(['.includes(c)) {
                    stack.push(c);
                    continue;
                }
                if (c === '{') {
                    stack.push('{');
                    continue;
                }
                if (c in pairs) {
                    const open = stack.pop();
                    const expected = c === '}' ? ['{', '${'] : [pairs[c]];
                    assert.ok(
                        open !== undefined && expected.includes(open),
                        `${name}: unbalanced ${c} (open was ${open})`
                    );
                }
            }
            assert.deepEqual(stack, [], `${name}: unclosed ${stack.join('')}`);
        }
    });
});
