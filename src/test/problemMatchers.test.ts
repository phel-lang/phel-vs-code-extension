// The `$phel-lint` / `$phel-test-watch` problem matchers, driven by the output
// they exist to parse. Both regexes are read out of `package.json` rather than
// copied here: a matcher that stops matching produces no error anywhere — the
// task just runs and the Problems panel stays empty.
//
// The lines below were captured from Phel v0.50.0-beta: `phel lint` over
// phel-lang's own `src/phel` and over a deliberately broken file (with the
// severities remapped through a `phel-lint.phel` config to reach `info` and
// `hint`), and `phel test --watch` over a file with one failing and one
// erroring `deftest`. Only the leading directories of the absolute paths are
// shortened.

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface ProblemPattern {
    regexp: string;
    file?: number;
    line?: number;
    column?: number;
    severity?: number;
    code?: number;
    message?: number;
}

interface ProblemMatcher {
    name: string;
    owner: string;
    severity?: string;
    fileLocation: unknown;
    background?: { activeOnStart?: boolean; beginsPattern: string; endsPattern: string };
    pattern: ProblemPattern;
}

const manifest: { contributes: { problemMatchers: ProblemMatcher[] } } = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8')
);

function matcher(name: string): ProblemMatcher {
    const found = manifest.contributes.problemMatchers.find((m) => m.name === name);
    assert.ok(found, `package.json contributes no problem matcher named ${name}`);
    return found;
}

/** The captures of `pattern` against `line`, keyed by the field they fill. */
function parse(pattern: ProblemPattern, line: string): Record<string, string> | undefined {
    const match = new RegExp(pattern.regexp).exec(line);
    if (!match) {
        return undefined;
    }
    const fields: Record<string, string> = {};
    for (const [field, group] of Object.entries(pattern)) {
        if (field !== 'regexp' && typeof group === 'number') {
            fields[field] = match[group];
        }
    }
    return fields;
}

describe('$phel-lint problem matcher', () => {
    const lint = matcher('phel-lint');

    it('parses an error line', () => {
        assert.deepEqual(
            parse(
                lint.pattern,
                "/home/dev/app/src/app/bad.phel:4:3 [error] phel/unresolved-symbol Cannot resolve symbol 'undefined-symbol'"
            ),
            {
                file: '/home/dev/app/src/app/bad.phel',
                line: '4',
                column: '3',
                severity: 'error',
                code: 'phel/unresolved-symbol',
                message: "Cannot resolve symbol 'undefined-symbol'",
            }
        );
    });

    it('parses every severity the human formatter prints', () => {
        const lines = [
            [
                "/home/dev/phel-lang/src/phel/core/io.phel:44:8 [warning] phel/shadowed-binding Shadowed binding: 'matches' shadows a local with the same name.",
                'warning',
            ],
            [
                "/home/dev/app/src/app/bad.phel:12:8 [info] phel/unused-binding Unused binding: 'tmp'.",
                'info',
            ],
            [
                '/home/dev/app/src/app/bad.phel:6:13 [hint] phel/duplicate-key Duplicate map key: :a.',
                'hint',
            ],
        ];
        for (const [line, severity] of lines) {
            assert.equal(parse(lint.pattern, line)?.severity, severity, line);
        }
    });

    it('keeps a message that carries its own colons and brackets', () => {
        const fields = parse(
            lint.pattern,
            "src/app/core.phel:9:2 [error] phel/arity-mismatch Wrong number of arguments for 'broken'. Expected 1, given 3."
        );
        assert.equal(fields?.file, 'src/app/core.phel');
        assert.equal(
            fields?.message,
            "Wrong number of arguments for 'broken'. Expected 1, given 3."
        );
    });

    it('ignores the rest of the run', () => {
        const near = [
            'No lint issues found.',
            '4 issue(s): 3 error(s), 1 warning(s), 0 info.',
            // The json/github formatters, not the human one this matcher reads.
            '::error file=src/app/bad.phel,line=4,col=3::Cannot resolve symbol',
            // A severity the formatter never prints.
            'src/app/core.phel:3:1 [notice] phel/duplicate-key Duplicate map key: :a.',
            // No brackets around the severity.
            'src/app/core.phel:3:1 warning phel/duplicate-key Duplicate map key: :a.',
        ];
        for (const line of near) {
            assert.equal(parse(lint.pattern, line), undefined, line);
        }
    });
});

describe('$phel-test-watch problem matcher', () => {
    const watch = matcher('phel-test-watch');

    it('brackets a re-run with the lines the watch loop prints', () => {
        assert.ok(watch.background, 'no background section');
        assert.match(
            'Change detected, re-running tests...',
            new RegExp(watch.background.beginsPattern)
        );
        assert.match(
            'Watching for file changes... (press Ctrl+C to stop)',
            new RegExp(watch.background.endsPattern)
        );
        // The first run happens before the loop announces itself, so the
        // matcher has to be collecting from the very first line.
        assert.equal(watch.background.activeOnStart, true);
    });

    it('parses a failure headline', () => {
        assert.deepEqual(
            parse(
                watch.pattern,
                "FAIL sum-is-wrong 'one plus one should be three' (failing_test.phel:4)"
            ),
            {
                code: 'FAIL',
                message: "sum-is-wrong 'one plus one should be three'",
                file: 'failing_test.phel',
                line: '4',
            }
        );
    });

    it('parses an error headline, which carries no message of its own', () => {
        assert.deepEqual(parse(watch.pattern, 'ERROR blows-up (failing_test.phel:7)'), {
            code: 'ERROR',
            message: 'blows-up',
            file: 'failing_test.phel',
            line: '7',
        });
    });

    it('reports at a fixed severity', () => {
        // The reporter prints FAIL / ERROR, neither of which VS Code maps to a
        // severity; both are failures, so the matcher fixes one for all of them
        // and the word itself goes in as the problem code.
        assert.equal(watch.severity, 'error');
        assert.equal(watch.pattern.severity, undefined);
    });

    it('ignores the rest of the report', () => {
        const near = [
            'FE.',
            '          Form: (+ 1 1)',
            '  evaluated to: 2',
            'Error: 1',
            'Passed: 1',
            'Time: 00:00.204, Memory: 38.00 MB',
            'Watching for file changes... (press Ctrl+C to stop)',
            // A headline for a test that reported no location.
            'FAIL sum-is-wrong',
        ];
        for (const line of near) {
            assert.equal(parse(watch.pattern, line), undefined, line);
        }
    });
});
