// The PHP-interop completion mapping, against what the real daemon answers.
//
// `src/test/fixtures/apiDaemonCompletions.json` was captured from
// `php bin/phel api-daemon` in a phel-lang checkout (v0.50), by piping one
// `completeAtPoint` request per interop position into it - `(php/strto`,
// `(php/-> d (get`, `(php/:: \DateTimeImmutable creat`, `\DateTi`, `(php/$_S`,
// `(.for| d)`, a `(php/-> c pre` whose receiver is a class with a public
// property, and one *non*-interop position. Each list is trimmed to its first
// few entries; nothing else was edited.
//
// The last one is why `phelFallback` is in there: a position the daemon does
// not read as interop - or one whose receiver it cannot type - is answered with
// Phel locals and `phel.core`, which is what the bundled provider offers
// anyway. Those items have to be dropped rather than shown twice.

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    type DaemonCompletion,
    isInteropCompletionPosition,
    parseCompletionResult,
    replacedTokenLength,
    toCompletionSpecs,
} from '../phelInteropCompletion';

const responses = JSON.parse(
    readFileSync(
        join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'apiDaemonCompletions.json'),
        { encoding: 'utf-8' }
    )
) as Record<string, unknown>;

function captured(name: string): DaemonCompletion[] {
    const items = parseCompletionResult(responses[name]);
    assert.ok(items.length > 0, `the captured ${name} answer must read as completions`);
    return items;
}

function specsOf(name: string) {
    return toCompletionSpecs(captured(name));
}

describe('isInteropCompletionPosition', () => {
    const interop = [
        '(php/-> d (get',
        '(php/-> d format',
        '  (php/-> (php/new \\DateTimeImmutable) (form',
        '(php/:: \\DateTimeImmutable creat',
        '(\\DateTimeImmutable/creat',
        'Cls/',
        '(Widget/$count',
        '(.for',
        '(.-length',
        '(.',
        '(php/new \\Date',
        '\\Date',
        '(let [x \\Foo\\Bar',
        '(php/$_S',
        'php/str',
        '(php/strtoupper',
        '(str (php/strle',
    ];

    for (const prefix of interop) {
        it(`recognises ${JSON.stringify(prefix)}`, () => {
            assert.equal(isInteropCompletionPosition(prefix), true);
        });
    }

    const plain = [
        '',
        '(map',
        '(defn greet [name]',
        // An alias-qualified Phel symbol: the bundled provider's own position.
        'str/joi',
        '(str/joi',
        // `php/new` and its siblings are Phel forms, not PHP functions.
        '(php/new',
        '(php/aget',
        // The prefix alone is not yet a position: `php/` names nothing.
        '(php/',
        // Interop-looking text the compiler never sees as code.
        '(def path "C:\\Users',
        '; see \\DateTimeImmutable',
        '(str "a; b") (map',
    ];

    for (const prefix of plain) {
        it(`leaves ${JSON.stringify(prefix)} to the bundled provider`, () => {
            assert.equal(isInteropCompletionPosition(prefix), false);
        });
    }
});

describe('replacedTokenLength', () => {
    it('replaces the member, not the `php/` prefix it was offered for', () => {
        assert.equal(replacedTokenLength('(php/strto'), 5);
        assert.equal(replacedTokenLength('(php/-> d (get'), 3);
        assert.equal(replacedTokenLength('(.for'), 3);
    });

    it('keeps the leading backslash of a class literal', () => {
        // The labels are unrooted (`Symfony\Component\…`), so the `\` stays.
        assert.equal(replacedTokenLength('(php/new \\Date'), 4);
        assert.equal(replacedTokenLength('\\Symfony\\Comp'), 12);
    });

    it('replaces a variable together with its sigil', () => {
        assert.equal(replacedTokenLength('(php/$_S'), 3);
    });

    it('is zero where nothing of the symbol is typed yet', () => {
        assert.equal(replacedTokenLength('(php/-> d '), 0);
        assert.equal(replacedTokenLength(''), 0);
    });
});

describe('parseCompletionResult', () => {
    it('reads what the daemon answers', () => {
        assert.deepEqual(captured('classConstants'), [
            { label: 'ATOM', kind: 'keyword', detail: 'constant', documentation: '' },
        ]);
    });

    it('answers nothing for anything that is not a list of completions', () => {
        assert.deepEqual(parseCompletionResult(undefined), []);
        assert.deepEqual(parseCompletionResult(null), []);
        assert.deepEqual(parseCompletionResult({ label: 'nope' }), []);
        assert.deepEqual(parseCompletionResult('[]'), []);
    });

    it('skips entries that cannot name a symbol', () => {
        assert.deepEqual(parseCompletionResult([{ label: '' }, null, 'strlen', 42]), []);
    });

    it('fills in the fields an older daemon may leave out', () => {
        assert.deepEqual(parseCompletionResult([{ label: 'strlen' }]), [
            { label: 'strlen', kind: '', detail: '', documentation: '' },
        ]);
    });
});

describe('toCompletionSpecs', () => {
    it('maps a PHP global function to a function, with its signature', () => {
        const upper = specsOf('globalFunctions').find((s) => s.label === 'strtoupper');
        assert.ok(upper, 'strtoupper must survive the mapping');
        assert.equal(upper.kind, 'function');
        assert.equal(upper.detail, 'strtoupper(string $string): string');
        // No signature help is reachable through the daemon, so the popup is
        // where the signature has to be readable.
        assert.equal(upper.documentation, '```php\nstrtoupper(string $string): string\n```');
        assert.equal(upper.insertText, undefined);
    });

    it('maps a method to a method, whether it is an instance or a static one', () => {
        for (const name of ['instanceMethods', 'staticMethods', 'dotShorthand']) {
            for (const spec of specsOf(name)) {
                assert.equal(spec.kind, 'method', `${name}/${spec.label}`);
            }
        }
    });

    it('maps a class and an interface to a class', () => {
        const specs = specsOf('classNames');
        assert.deepEqual(
            specs.map((s) => [s.label, s.kind]),
            [
                ['DateTime', 'class'],
                ['DateTimeImmutable', 'class'],
                ['DateTimeZone', 'class'],
                ['DateTimeInterface', 'class'],
            ]
        );
        assert.equal(specs[0].documentation, '');
    });

    it('maps a property to a property and a constant to a constant', () => {
        assert.deepEqual(
            specsOf('instanceProperties').map((s) => [s.label, s.kind, s.detail]),
            [['prefix', 'property', 'string property']]
        );
        assert.deepEqual(
            specsOf('classConstants').map((s) => [s.label, s.kind]),
            [['ATOM', 'constant']]
        );
    });

    it('writes a superglobal with its sigil', () => {
        const [server] = specsOf('superglobals');
        assert.equal(server.label, '$_SERVER');
        assert.equal(server.kind, 'variable');
        assert.equal(server.insertText, '$_SERVER');
        assert.equal(server.documentation, 'Server and execution environment information.');
    });

    it('sorts interop items ahead of the bundled ones', () => {
        for (const spec of specsOf('globalFunctions')) {
            assert.equal(spec.sortText, `0_${spec.label}`);
        }
    });

    it('keeps the order the daemon listed them in', () => {
        assert.deepEqual(
            specsOf('instanceMethods').map((s) => s.label),
            ['getTimezone', 'getOffset', 'getTimestamp']
        );
    });

    it('drops the Phel completions the daemon falls back to', () => {
        // `xs` is a local binding, `map` and `macroexpand` are `phel.core`:
        // all three are the bundled provider's business, not this one's.
        assert.deepEqual(specsOf('phelFallback'), []);
    });

    it('drops a workspace definition, whose detail is its namespace', () => {
        const items = parseCompletionResult([
            { label: 'shout', kind: 'global', detail: 'demo.strings', documentation: '' },
            { label: 'when-not', kind: 'macro', detail: 'core', documentation: '' },
        ]);
        assert.deepEqual(toCompletionSpecs(items), []);
    });

    it('keeps a static property, sigil and all', () => {
        // Reflection over an internal class reports none, so the capture has
        // no case for the one member kind spelled `\Foo/$bar` (ADR 0013).
        const items = parseCompletionResult([
            { label: '$count', kind: 'variable', detail: 'int static property' },
        ]);
        assert.deepEqual(toCompletionSpecs(items), [
            {
                label: '$count',
                kind: 'variable',
                detail: 'int static property',
                documentation: '',
                insertText: '$count',
                sortText: '0_$count',
            },
        ]);
    });

    it('keeps a function the reflector could not render a signature for', () => {
        const items = parseCompletionResult([
            { label: 'my_helper', kind: 'global', detail: 'function' },
        ]);
        assert.deepEqual(
            toCompletionSpecs(items).map((s) => [s.label, s.kind, s.documentation]),
            [['my_helper', 'function', '']]
        );
    });
});
