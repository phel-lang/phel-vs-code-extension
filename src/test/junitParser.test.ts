import * as assert from 'node:assert/strict';
import { groupByName, parseJUnit } from '../junitParser';

// Captured verbatim from `phel test --reporter=junit-xml` (Phel v0.45.x):
// one passing deftest with two assertions (two <testcase> rows) and one
// failing deftest with one assertion.
const REAL_XML =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<testsuites tests="3" failures="1" errors="0" time="0.0">' +
    '<testsuite name="jtest.sample-test" tests="3" failures="1" errors="0" time="0.0">' +
    '<testcase name="test-passes" classname="" file="/abs/sample_test.phel" line="4"></testcase>' +
    '<testcase name="test-passes" classname="" file="/abs/sample_test.phel" line="4"></testcase>' +
    '<testcase name="test-fails" classname="" file="/abs/sample_test.phel" line="8">' +
    '<failure message="one should equal two" type="AssertionFailed">(= 1 2)</failure>' +
    '</testcase>' +
    '</testsuite></testsuites>';

describe('junitParser.parseJUnit', () => {
    it('parses the real Phel reporter output', () => {
        const cases = parseJUnit(REAL_XML);
        assert.equal(cases.length, 3);
        assert.equal(cases[0].name, 'test-passes');
        assert.equal(cases[0].suite, 'jtest.sample-test');
        assert.equal(cases[0].file, '/abs/sample_test.phel');
        assert.equal(cases[0].line, 4);
        assert.deepEqual(cases[0].failures, []);

        assert.equal(cases[2].name, 'test-fails');
        assert.equal(cases[2].line, 8);
        assert.equal(cases[2].failures.length, 1);
        assert.equal(cases[2].failures[0].message, 'one should equal two');
        assert.equal(cases[2].failures[0].type, 'AssertionFailed');
        assert.equal(cases[2].failures[0].detail, '(= 1 2)');
        assert.equal(cases[2].failures[0].isError, false);
    });

    it('aggregates per-assertion rows by test name', () => {
        const grouped = groupByName(parseJUnit(REAL_XML));
        assert.equal(grouped.size, 2);
        const passes = grouped.get('jtest.sample-test::test-passes');
        assert.ok(passes);
        assert.equal(passes.passed, true);
        assert.equal(passes.failures.length, 0);

        const fails = grouped.get('jtest.sample-test::test-fails');
        assert.ok(fails);
        assert.equal(fails.passed, false);
        assert.equal(fails.failures.length, 1);
    });

    it('marks a test failed if any of its rows failed', () => {
        const xml =
            '<testsuites><testsuite name="ns">' +
            '<testcase name="t" file="/f.phel" line="1"></testcase>' +
            '<testcase name="t" file="/f.phel" line="1"><failure message="boom" type="AssertionFailed">(x)</failure></testcase>' +
            '</testsuite></testsuites>';
        const grouped = groupByName(parseJUnit(xml));
        const t = grouped.get('ns::t');
        assert.ok(t);
        assert.equal(t.passed, false);
        assert.equal(t.failures.length, 1);
        assert.equal(t.failures[0].message, 'boom');
    });

    it('decodes XML entities in messages and detail', () => {
        const xml =
            '<testsuites><testsuite name="ns">' +
            '<testcase name="t" file="/f.phel" line="1">' +
            '<failure message="expected &lt;a&gt; &amp; &quot;b&quot;" type="T">(= &lt;a&gt; b)</failure>' +
            '</testcase></testsuite></testsuites>';
        const [c] = parseJUnit(xml);
        assert.equal(c.failures[0].message, 'expected <a> & "b"');
        assert.equal(c.failures[0].detail, '(= <a> b)');
    });

    it('handles <error> elements as errors', () => {
        const xml =
            '<testsuites><testsuite name="ns">' +
            '<testcase name="t" file="/f.phel" line="1">' +
            '<error message="kaboom" type="RuntimeException">stack</error>' +
            '</testcase></testsuite></testsuites>';
        const [c] = parseJUnit(xml);
        assert.equal(c.failures[0].isError, true);
        assert.equal(c.failures[0].message, 'kaboom');
    });

    it('handles self-closing testcase tags', () => {
        const xml =
            '<testsuites><testsuite name="ns">' +
            '<testcase name="t" file="/f.phel" line="3"/>' +
            '</testsuite></testsuites>';
        const cases = parseJUnit(xml);
        assert.equal(cases.length, 1);
        assert.equal(cases[0].name, 't');
        assert.equal(cases[0].line, 3);
        assert.deepEqual(cases[0].failures, []);
    });

    it('returns an empty array for empty or malformed input', () => {
        assert.deepEqual(parseJUnit(''), []);
        assert.deepEqual(parseJUnit('not xml'), []);
    });
});
