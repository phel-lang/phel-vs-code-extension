import * as assert from 'node:assert/strict';
import { parseRunTestsSummary, parseTestReport } from '../phelNreplTestReport';

// Every fixture below is the `out` frame of a real `run-tests` op, captured
// verbatim from a `phel nrepl` server (Phel 0.50.x) running against the project
// `scripts/make-real-cli-fixture.sh` builds. Nothing here is hand-written: the
// padding is right-aligned per failure type and the caret column of a string
// diff is counted in bytes, so a fixture typed from memory would test a
// reporter that does not exist.

/** `run-test 'demo.failing-test/test-shout-fails` — one `=` failure over two strings. */
const SHOUT_FAILS = `

~~~~~~~~~~
FAIL test-shout-fails (failing_test.phel:8)
          Form: (shout "hi")
  evaluated to: "HI!"
    but is not: = to "this will never match"
  String diff (first mismatch at index 0):
    expected: "this will never match"
    actual:   "HI!"
               ^


Passed: 0
Failed: 1
Error: 0
Total: 1
`;

/** `run-test 'demo.failing-test/test-shout-passes` — nothing but the counts. */
const SHOUT_PASSES = `

Passed: 1
Failed: 0
Error: 0
Total: 1
`;

/**
 * `run-tests 'demo.probe-test` over one file holding one instance of every
 * failure the reporter renders differently: an `is` message, an assertion with
 * no location, a predicate, a collection diff, `thrown?`, `thrown-with-msg?`,
 * an assertion that threw, and two failures inside one `deftest`.
 */
const EVERY_KIND = `

~~~~~~~~~~
FAIL t-message 'one is not two' (probe_test.phel:4)
          Form: 2
  evaluated to: 2
    but is not: = to 1
~~~~~~~~~~
FAIL t-no-location
          Form: false
  evaluated to: false (which is not truthy)
~~~~~~~~~~
FAIL t-predicate (probe_test.phel:10)
                 Form: -1
         evaluated to: -1
  but doesn't satisfy: pos?
~~~~~~~~~~
FAIL t-collection (probe_test.phel:13)
          Form: [1 9 3]
  evaluated to: [1 9 3]
    but is not: = to [1 2 3]
  Diff:
      [0] 1
    - [1] 2
    + [1] 9
      [2] 3
~~~~~~~~~~
FAIL t-thrown (probe_test.phel:16)
    expected: (thrown? \\InvalidArgumentException (+ 1 1))
  to throw a: \\InvalidArgumentException (it didn't)
~~~~~~~~~~
FAIL t-thrown-with-msg (probe_test.phel:19)
      expected: (thrown-with-msg? \\Exception "boom" (throw (php/new \\Exception "bang")))
    to throw a: \\Exception
  with message: boom
       but got: bang
~~~~~~~~~~
ERROR t-error (probe_test.phel:22)
              Form: (= 1 (php/intdiv 1 0))
             threw: DivisionByZeroError
      with message: Division by zero
~~~~~~~~~~
FAIL t-two-failures (probe_test.phel:25)
          Form: "b"
  evaluated to: "b"
    but is not: = to "a"
  String diff (first mismatch at index 0):
    expected: "a"
    actual:   "b"
               ^
~~~~~~~~~~
FAIL t-two-failures (probe_test.phel:25)
          Form: 4
  evaluated to: 4
    but is not: = to 3


Passed: 0
Failed: 8
Error: 1
Total: 9
`;

describe('phelNreplTestReport.parseRunTestsSummary', () => {
    it('reads the map a run-tests op returns', () => {
        assert.deepEqual(parseRunTestsSummary('{:pass 1, :fail 1, :error 0}'), {
            pass: 1,
            fail: 1,
            error: 0,
        });
        assert.deepEqual(parseRunTestsSummary('{:pass 0, :fail 1, :error 0}'), {
            pass: 0,
            fail: 1,
            error: 0,
        });
        assert.deepEqual(parseRunTestsSummary('{:pass 0, :fail 8, :error 1}'), {
            pass: 0,
            fail: 8,
            error: 1,
        });
    });

    it('does not mind the key order', () => {
        assert.deepEqual(parseRunTestsSummary('{:error 2 :fail 3 :pass 4}'), {
            pass: 4,
            fail: 3,
            error: 2,
        });
    });

    it('answers null for anything that is not one', () => {
        assert.equal(parseRunTestsSummary(''), null);
        assert.equal(parseRunTestsSummary('nil'), null);
        assert.equal(parseRunTestsSummary('{:pass 1}'), null);
        assert.equal(
            parseRunTestsSummary('Phel\\Compiler\\Domain\\Exceptions\\CompilerException'),
            null
        );
    });
});

describe('phelNreplTestReport.parseTestReport', () => {
    it('reads a string-diff failure, with its location', () => {
        const failures = parseTestReport(SHOUT_FAILS);

        assert.equal(failures.length, 1);
        assert.equal(failures[0].kind, 'FAIL');
        assert.equal(failures[0].testName, 'test-shout-fails');
        assert.equal(failures[0].file, 'failing_test.phel');
        assert.equal(failures[0].line, 8);
        assert.equal(failures[0].form, '(shout "hi")');
        assert.equal(failures[0].pred, '=');
        assert.equal(failures[0].expected, '"this will never match"');
        assert.equal(failures[0].actual, '"HI!"');
        assert.equal(failures[0].message, undefined);
    });

    it('keeps the whole printed block as the detail', () => {
        const [failure] = parseTestReport(SHOUT_FAILS);

        assert.match(failure.detail, /String diff \(first mismatch at index 0\)/);
        assert.match(failure.detail, /^ {10}Form: \(shout "hi"\)$/m);
        // The counts below the report are not part of any block.
        assert.doesNotMatch(failure.detail, /Passed:/);
    });

    it('finds nothing in a passing run', () => {
        assert.deepEqual(parseTestReport(SHOUT_PASSES), []);
        assert.deepEqual(parseTestReport(''), []);
    });

    it('reads every failure of a run, in order', () => {
        const failures = parseTestReport(EVERY_KIND);

        assert.deepEqual(
            failures.map((f) => `${f.kind} ${f.testName}`),
            [
                'FAIL t-message',
                'FAIL t-no-location',
                'FAIL t-predicate',
                'FAIL t-collection',
                'FAIL t-thrown',
                'FAIL t-thrown-with-msg',
                'ERROR t-error',
                'FAIL t-two-failures',
                'FAIL t-two-failures',
            ]
        );
    });

    it('reads the `is` message out of the headline', () => {
        const [message] = parseTestReport(EVERY_KIND);

        assert.equal(message.testName, 't-message');
        assert.equal(message.message, 'one is not two');
        assert.equal(message.file, 'probe_test.phel');
        assert.equal(message.line, 4);
        assert.equal(message.expected, '1');
        assert.equal(message.actual, '2');
    });

    it('accepts a headline without a location', () => {
        const failure = parseTestReport(EVERY_KIND)[1];

        assert.equal(failure.testName, 't-no-location');
        assert.equal(failure.file, undefined);
        assert.equal(failure.line, undefined);
        assert.equal(failure.form, 'false');
        // `(which is not truthy)` is the reporter's aside, not part of the value.
        assert.equal(failure.actual, 'false');
    });

    it('reads a predicate failure', () => {
        const failure = parseTestReport(EVERY_KIND)[2];

        assert.equal(failure.pred, 'pos?');
        assert.equal(failure.form, '-1');
        assert.equal(failure.actual, '-1');
        assert.equal(failure.expected, undefined);
    });

    it('does not read fields back out of a diff block', () => {
        const failure = parseTestReport(EVERY_KIND)[3];

        assert.equal(failure.expected, '[1 2 3]');
        assert.equal(failure.actual, '[1 9 3]');
        assert.match(failure.detail, /- \[1] 2/);
    });

    it('reads a thrown? failure as the exception it wanted', () => {
        const failure = parseTestReport(EVERY_KIND)[4];

        assert.equal(failure.form, '(thrown? \\InvalidArgumentException (+ 1 1))');
        assert.equal(failure.expected, '\\InvalidArgumentException');
        assert.equal(failure.actual, undefined);
    });

    it('reads a thrown-with-msg? failure as the two messages', () => {
        const failure = parseTestReport(EVERY_KIND)[5];

        assert.match(failure.form ?? '', /^\(thrown-with-msg\? \\Exception "boom"/);
        assert.equal(failure.expected, 'boom');
        assert.equal(failure.actual, 'bang');
    });

    it('reads an assertion that threw as an ERROR', () => {
        const failure = parseTestReport(EVERY_KIND)[6];

        assert.equal(failure.kind, 'ERROR');
        assert.equal(failure.form, '(= 1 (php/intdiv 1 0))');
        assert.equal(failure.actual, 'DivisionByZeroError');
        // The exception's own message belongs with it in the detail, not as the
        // expected side of a diff that has no expected side.
        assert.equal(failure.expected, undefined);
        assert.match(failure.detail, /with message: Division by zero/);
    });

    it('keeps two failures of the same deftest apart', () => {
        const failures = parseTestReport(EVERY_KIND).filter((f) => f.testName === 't-two-failures');

        assert.equal(failures.length, 2);
        assert.equal(failures[0].expected, '"a"');
        assert.equal(failures[0].actual, '"b"');
        assert.equal(failures[1].expected, '3');
        assert.equal(failures[1].actual, '4');
        // Both report the `deftest`'s line: the assertion forms the macro
        // rebuilt inherit its location.
        assert.deepEqual(
            failures.map((f) => f.line),
            [25, 25]
        );
    });

    it('ignores anything printed outside a block', () => {
        const noisy = [
            'Discovering tests...',
            'Loading 37 namespace(s)...',
            '.F',
            SHOUT_FAILS,
        ].join('\n');

        assert.equal(parseTestReport(noisy).length, 1);
    });
});
