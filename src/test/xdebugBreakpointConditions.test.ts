import * as assert from 'node:assert/strict';
import {
    breakpointSetArgs,
    interpolateLogMessage,
    matchBreakpoint,
    mungeName,
    parseHitCondition,
    parseLogMessage,
    phelExpressionToPhp,
} from '../xdebugBreakpointConditions';

// The mapping this whole file rests on is phel-lang's `Munge::SYMBOL_MAPPING`
// (src/php/Shared/Munge.php). A condition names the variable the *compiler*
// emitted, so getting one of these wrong means a breakpoint that silently never
// fires. The pairs below are read straight off that table.
describe('mungeName', () => {
    it('spells a name the way the compiler emits it', () => {
        assert.equal(mungeName('foo-bar'), 'foo_bar');
        assert.equal(mungeName('blank?'), 'blank_QMARK_');
        assert.equal(mungeName('set!'), 'set_BANG_');
        assert.equal(mungeName('str/join'), 'str_SLASH_join');
        assert.equal(mungeName('*state*'), '_STAR_state_STAR_');
        assert.equal(mungeName('a+b'), 'a_PLUS_b');
        assert.equal(mungeName('x=y'), 'x_EQ_y');
        assert.equal(mungeName('a.b'), 'a_DOT_b');
        assert.equal(mungeName('<'), '_LT_');
        assert.equal(mungeName('>'), '_GT_');
    });

    it('renames `this`, which PHP owns', () => {
        assert.equal(mungeName('this'), '__phel_this');
    });

    it('leaves a name PHP could already spell alone', () => {
        assert.equal(mungeName('count'), 'count');
        assert.equal(mungeName('x2'), 'x2');
    });
});

describe('phelExpressionToPhp', () => {
    it('turns a bare Phel local into its munged variable', () => {
        assert.equal(phelExpressionToPhp('foo'), '$foo');
        assert.equal(phelExpressionToPhp('my-var'), '$my_var');
        assert.equal(phelExpressionToPhp('blank?'), '$blank_QMARK_');
        assert.equal(phelExpressionToPhp('var1'), '$var1');
    });

    it('trims what it is given', () => {
        assert.equal(phelExpressionToPhp('  foo  '), '$foo');
        assert.equal(phelExpressionToPhp('\tbar\n'), '$bar');
    });

    it('translates the locals inside a comparison', () => {
        assert.equal(phelExpressionToPhp('item-count > 3'), '$item_count > 3');
        assert.equal(
            phelExpressionToPhp('found? && n-tries >= 2'),
            '$found_QMARK_ && $n_tries >= 2'
        );
    });

    it('leaves what is already PHP alone', () => {
        assert.equal(phelExpressionToPhp('$foo'), '$foo');
        assert.equal(phelExpressionToPhp('$arr[0]'), '$arr[0]');
        assert.equal(phelExpressionToPhp('$a->b'), '$a->b');
        assert.equal(phelExpressionToPhp('Foo::BAR'), 'Foo::BAR');
        assert.equal(
            phelExpressionToPhp('\\Phel\\Lang\\Keyword::create("k")'),
            '\\Phel\\Lang\\Keyword::create("k")'
        );
        assert.equal(phelExpressionToPhp('true'), 'true');
        assert.equal(phelExpressionToPhp('$x !== null'), '$x !== null');
    });

    it('reads `nil` as PHP null', () => {
        assert.equal(phelExpressionToPhp('x != nil'), '$x != null');
    });

    it('treats a name in front of `(` as the call it is', () => {
        assert.equal(phelExpressionToPhp('count(xs) > 2'), 'count($xs) > 2');
    });

    it('does not look inside strings', () => {
        assert.equal(phelExpressionToPhp('$name == "my-var"'), '$name == "my-var"');
        assert.equal(phelExpressionToPhp("$name == 'a-b'"), "$name == 'a-b'");
    });

    it('does not read a number as a name', () => {
        assert.equal(phelExpressionToPhp('n > 1e5'), '$n > 1e5');
        assert.equal(phelExpressionToPhp('n == 0x1f'), '$n == 0x1f');
    });

    it('builds a keyword through the factory, not the private constructor', () => {
        // `Keyword::__construct` is private in phel-lang, so `new Keyword(...)`
        // is a fatal error in the evaluated snippet.
        assert.equal(phelExpressionToPhp(':status'), '\\Phel\\Lang\\Keyword::create("status")');
        assert.equal(phelExpressionToPhp(':my-key'), '\\Phel\\Lang\\Keyword::create("my-key")');
        assert.equal(
            phelExpressionToPhp(':app/state'),
            '\\Phel\\Lang\\Keyword::create("state", "app")'
        );
    });

    it('takes the munging it is given', () => {
        assert.equal(
            phelExpressionToPhp('foo-bar', (name) => name.toUpperCase()),
            '$FOO-BAR'
        );
    });
});

describe('parseHitCondition', () => {
    it('reads a bare number as "from the nth hit on"', () => {
        assert.deepEqual(parseHitCondition('3'), { op: '>=', value: 3 });
        assert.deepEqual(parseHitCondition(' 12 '), { op: '>=', value: 12 });
    });

    it('reads the operators DBGp understands', () => {
        assert.deepEqual(parseHitCondition('>= 3'), { op: '>=', value: 3 });
        assert.deepEqual(parseHitCondition('== 3'), { op: '==', value: 3 });
        assert.deepEqual(parseHitCondition('= 3'), { op: '==', value: 3 });
        assert.deepEqual(parseHitCondition('% 3'), { op: '%', value: 3 });
        assert.deepEqual(parseHitCondition('%3'), { op: '%', value: 3 });
    });

    it('expresses "after n hits" as the >= DBGp has', () => {
        assert.deepEqual(parseHitCondition('> 4'), { op: '>=', value: 5 });
    });

    it('rejects what the engine would reject', () => {
        // The editor lets anything be typed here; sending it on would have
        // Xdebug refuse the whole breakpoint.
        assert.equal(parseHitCondition(undefined), null);
        assert.equal(parseHitCondition(''), null);
        assert.equal(parseHitCondition('every other'), null);
        assert.equal(parseHitCondition('>= x'), null);
        assert.equal(parseHitCondition('0'), null);
    });
});

describe('breakpointSetArgs', () => {
    const URI = 'file:///tmp/phel/demo__a5b0.php';

    it('sets a plain line breakpoint when there is nothing else to say', () => {
        assert.deepEqual(breakpointSetArgs(URI, 29), {
            args: { t: 'line', f: URI, n: '29' },
        });
    });

    it('sends a condition as the data payload of a conditional breakpoint', () => {
        // DBGp carries the expression in the payload; there is no argument for
        // it, and `-t line` ignores one.
        assert.deepEqual(breakpointSetArgs(URI, 29, { condition: 'item-count > 3' }), {
            args: { t: 'conditional', f: URI, n: '29' },
            data: '$item_count > 3',
        });
    });

    it('sends a hit count as -h/-o', () => {
        assert.deepEqual(breakpointSetArgs(URI, 29, { hitCondition: '% 5' }), {
            args: { t: 'line', f: URI, n: '29', h: '5', o: '%' },
        });
    });

    it('sends both at once', () => {
        assert.deepEqual(breakpointSetArgs(URI, 7, { condition: 'x', hitCondition: '>= 2' }), {
            args: { t: 'conditional', f: URI, n: '7', h: '2', o: '>=' },
            data: '$x',
        });
    });

    it('ignores a hit count the engine could not use', () => {
        assert.deepEqual(breakpointSetArgs(URI, 7, { hitCondition: 'sometimes' }), {
            args: { t: 'line', f: URI, n: '7' },
        });
    });

    it('ignores a blank condition', () => {
        assert.deepEqual(breakpointSetArgs(URI, 7, { condition: '   ' }), {
            args: { t: 'line', f: URI, n: '7' },
        });
    });
});

describe('parseLogMessage', () => {
    it('splits literal text from expressions', () => {
        assert.deepEqual(parseLogMessage('n is {n} now'), [
            { kind: 'text', value: 'n is ' },
            { kind: 'expression', value: 'n' },
            { kind: 'text', value: ' now' },
        ]);
    });

    it('keeps a message with no expression in one piece', () => {
        assert.deepEqual(parseLogMessage('here'), [{ kind: 'text', value: 'here' }]);
    });

    it('escapes a literal brace', () => {
        assert.deepEqual(parseLogMessage('\\{n\\}'), [{ kind: 'text', value: '{n}' }]);
    });

    it('treats an unclosed brace as text', () => {
        assert.deepEqual(parseLogMessage('oops {n'), [{ kind: 'text', value: 'oops {n' }]);
    });

    it('drops an empty expression', () => {
        assert.deepEqual(parseLogMessage('a{}b'), [{ kind: 'text', value: 'ab' }]);
    });
});

describe('interpolateLogMessage', () => {
    it('replaces every expression with what evaluating it answered', async () => {
        const seen: string[] = [];
        const text = await interpolateLogMessage('{x} then {y-z}', async (expression) => {
            seen.push(expression);
            return expression === 'x' ? '1' : '2';
        });

        assert.equal(text, '1 then 2');
        assert.deepEqual(seen, ['x', 'y-z']);
    });

    it('never evaluates anything for a plain message', async () => {
        const text = await interpolateLogMessage('plain', async () => {
            throw new Error('should not be called');
        });
        assert.equal(text, 'plain');
    });
});

describe('matchBreakpoint', () => {
    const breakpoints = [
        { phpFile: '/tmp/phel/a.php', phpLines: [10, 11, 12], name: 'a' },
        { phpFile: '/tmp/phel/b.php', phpLines: [4], name: 'b' },
        { phpFile: null, phpLines: [], name: 'unmapped' },
    ];

    it('finds the breakpoint the engine stopped on', () => {
        assert.equal(matchBreakpoint(breakpoints, '/tmp/phel/b.php', 4)?.name, 'b');
    });

    it('recognises any of the lines one Phel line compiled to', () => {
        // A multi-expression line installs a breakpoint per candidate; the
        // engine reports whichever one it reached.
        assert.equal(matchBreakpoint(breakpoints, '/tmp/phel/a.php', 12)?.name, 'a');
    });

    it('answers nothing for a line nothing was installed on', () => {
        assert.equal(matchBreakpoint(breakpoints, '/tmp/phel/a.php', 99), undefined);
        assert.equal(matchBreakpoint(breakpoints, '/tmp/phel/c.php', 10), undefined);
    });

    it('compares paths across separators', () => {
        assert.equal(matchBreakpoint(breakpoints, '\\tmp\\phel\\b.php', 4)?.name, 'b');
    });
});
