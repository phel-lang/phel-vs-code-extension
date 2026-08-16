import * as assert from 'assert';
import {
    dedupeLiveDiagnostics,
    groupDiagnosticsByUri,
    isUnknownCommandError,
    normaliseDiagnostics,
    parsePhelAnalyzeOutput,
    toZeroBasedRange,
    PhelDiagnostic,
} from '../phelDiagnostics';

describe('parsePhelAnalyzeOutput', function () {
    it('returns an empty array for an empty string', function () {
        assert.deepStrictEqual(parsePhelAnalyzeOutput(''), []);
        assert.deepStrictEqual(parsePhelAnalyzeOutput('   \n  '), []);
    });

    it('returns an empty array when phel reports no issues', function () {
        assert.deepStrictEqual(parsePhelAnalyzeOutput('[]\n'), []);
    });

    it('parses one diagnostic with all fields', function () {
        const output = JSON.stringify([
            {
                code: 'PHEL001',
                severity: 'error',
                message: "Cannot resolve symbol 'foo'.",
                uri: '/tmp/file.phel',
                startLine: 12,
                startCol: 36,
                endLine: 12,
                endCol: 40,
            },
        ]);
        const [diag] = parsePhelAnalyzeOutput(output);
        assert.strictEqual(diag.code, 'PHEL001');
        assert.strictEqual(diag.severity, 'error');
        assert.strictEqual(diag.message, "Cannot resolve symbol 'foo'.");
        assert.strictEqual(diag.uri, '/tmp/file.phel');
        assert.strictEqual(diag.startLine, 12);
        assert.strictEqual(diag.startCol, 36);
        assert.strictEqual(diag.endLine, 12);
        assert.strictEqual(diag.endCol, 40);
    });

    it('drops entries that lack a message or numeric start position', function () {
        const output = JSON.stringify([
            { severity: 'error', startLine: 1, startCol: 1, endLine: 1, endCol: 2 }, // no message
            { message: 'no start cols', severity: 'error' },
            {
                message: 'good',
                severity: 'error',
                startLine: 1,
                startCol: 1,
                endLine: 1,
                endCol: 5,
            },
        ]);
        const out = parsePhelAnalyzeOutput(output);
        assert.strictEqual(out.length, 1);
        assert.strictEqual(out[0].message, 'good');
    });

    it('falls back to startLine/startCol when end positions are missing', function () {
        const output = JSON.stringify([
            { message: 'no end', severity: 'error', startLine: 5, startCol: 7 },
        ]);
        const [diag] = parsePhelAnalyzeOutput(output);
        assert.strictEqual(diag.endLine, 5);
        assert.strictEqual(diag.endCol, 7);
    });

    it('normalises severity strings and maps unknown values to "info"', function () {
        const output = JSON.stringify([
            { message: 'a', severity: 'ERROR', startLine: 1, startCol: 1, endLine: 1, endCol: 2 },
            { message: 'b', severity: 'warn', startLine: 1, startCol: 1, endLine: 1, endCol: 2 },
            { message: 'c', severity: 'note', startLine: 1, startCol: 1, endLine: 1, endCol: 2 },
            { message: 'd', severity: 'mystery', startLine: 1, startCol: 1, endLine: 1, endCol: 2 },
            { message: 'e', startLine: 1, startCol: 1, endLine: 1, endCol: 2 },
        ]);
        const sevs = parsePhelAnalyzeOutput(output).map((d) => d.severity);
        assert.deepStrictEqual(sevs, ['error', 'warning', 'info', 'info', 'info']);
    });

    it('skips a non-JSON pre-amble before the array', function () {
        const output =
            'Phel CLI banner you can ignore\n' +
            JSON.stringify([
                {
                    message: 'late',
                    severity: 'error',
                    startLine: 2,
                    startCol: 3,
                    endLine: 2,
                    endCol: 4,
                },
            ]);
        const out = parsePhelAnalyzeOutput(output);
        assert.strictEqual(out.length, 1);
        assert.strictEqual(out[0].message, 'late');
    });

    it('returns [] when the JSON is malformed', function () {
        assert.deepStrictEqual(parsePhelAnalyzeOutput('[ {garbage'), []);
    });

    it('returns [] when the JSON is not an array', function () {
        assert.deepStrictEqual(parsePhelAnalyzeOutput('{"message":"oops"}'), []);
    });
});

describe('toZeroBasedRange', function () {
    function diag(overrides: Partial<PhelDiagnostic> = {}): PhelDiagnostic {
        return {
            message: 'msg',
            severity: 'error',
            startLine: 1,
            startCol: 1,
            endLine: 1,
            endCol: 2,
            ...overrides,
        };
    }

    it('translates to half-open zero-based positions', function () {
        const r = toZeroBasedRange(diag({ startLine: 12, startCol: 36, endLine: 12, endCol: 40 }));
        assert.deepStrictEqual(r, { startLine: 11, startCol: 36, endLine: 11, endCol: 40 });
    });

    it('expands a zero-width range so VS Code shows a marker', function () {
        const r = toZeroBasedRange(diag({ startLine: 5, startCol: 7, endLine: 5, endCol: 7 }));
        assert.deepStrictEqual(r, { startLine: 4, startCol: 7, endLine: 4, endCol: 8 });
    });

    it('clamps negative phel positions to zero', function () {
        const r = toZeroBasedRange(diag({ startLine: 0, startCol: 0, endLine: 0, endCol: 0 }));
        assert.deepStrictEqual(r, { startLine: 0, startCol: 0, endLine: 0, endCol: 1 });
    });
});

describe('groupDiagnosticsByUri', function () {
    const diag = (uri: string | undefined, message: string): PhelDiagnostic => ({
        message,
        severity: 'error',
        startLine: 1,
        startCol: 0,
        endLine: 1,
        endCol: 1,
        ...(uri ? { uri } : {}),
    });

    it('splits a multi-file lint run by file', function () {
        const grouped = groupDiagnosticsByUri([
            diag('/a.phel', 'one'),
            diag('/b.phel', 'two'),
            diag('/a.phel', 'three'),
        ]);
        assert.deepStrictEqual([...grouped.keys()], ['/a.phel', '/b.phel']);
        assert.deepStrictEqual(
            grouped.get('/a.phel')?.map((d) => d.message),
            ['one', 'three']
        );
    });

    it('attributes entries without a uri to the fallback', function () {
        const grouped = groupDiagnosticsByUri([diag(undefined, 'no uri')], '/fallback.phel');
        assert.deepStrictEqual([...grouped.keys()], ['/fallback.phel']);
    });

    it('drops entries with no uri and no fallback', function () {
        assert.strictEqual(groupDiagnosticsByUri([diag(undefined, 'orphan')]).size, 0);
    });

    it('returns an empty map for an empty run', function () {
        assert.strictEqual(groupDiagnosticsByUri([]).size, 0);
    });
});

describe('normaliseDiagnostics', function () {
    it('normalises the already-decoded objects a daemon call returns', function () {
        const out = normaliseDiagnostics([
            {
                code: 'PHEL001',
                severity: 'error',
                message: "Cannot resolve symbol 'foo'.",
                uri: '/tmp/file.phel',
                startLine: 3,
                startCol: 4,
                endLine: 3,
                endCol: 7,
            },
            { message: 'no position' },
            'not an object',
        ]);
        assert.strictEqual(out.length, 1);
        assert.strictEqual(out[0].code, 'PHEL001');
        assert.strictEqual(out[0].endCol, 7);
    });
});

describe('dedupeLiveDiagnostics', function () {
    const diag = (message: string, startLine = 1, startCol = 0): PhelDiagnostic => ({
        message,
        severity: 'error',
        startLine,
        startCol,
        endLine: startLine,
        endCol: startCol + 3,
    });

    it('drops a live entry the on-save run already reports', function () {
        // What `phel lint` does to an analyzer finding: same message, same
        // position, its own rule code. Matching on the code would miss it.
        const live = [{ ...diag("Cannot resolve symbol 'foo'."), code: 'PHEL001' }];
        const saved = [
            { ...diag("Cannot resolve symbol 'foo'."), code: 'phel/unresolved-symbol' },
            { ...diag("'x' is never used", 9), code: 'phel/unused-binding' },
        ];
        assert.deepStrictEqual(dedupeLiveDiagnostics(live, saved), []);
    });

    it('keeps a live entry the saved run reports elsewhere', function () {
        const live = [diag('same message', 4)];
        const saved = [diag('same message', 9)];
        assert.deepStrictEqual(dedupeLiveDiagnostics(live, saved), live);
    });

    it('keeps everything when nothing was saved', function () {
        const live = [diag('one'), diag('two', 2)];
        assert.deepStrictEqual(dedupeLiveDiagnostics(live, []), live);
    });
});

describe('isUnknownCommandError', function () {
    it('recognises the Symfony Console message for a missing subcommand', function () {
        // What a Phel older than `phel lint` prints on stderr.
        assert.strictEqual(isUnknownCommandError('  Command "lint" is not defined.  '), true);
    });

    it('does not treat a normal failure as a missing subcommand', function () {
        assert.strictEqual(isUnknownCommandError('Cannot parse file: /tmp/x.phel'), false);
        assert.strictEqual(isUnknownCommandError(''), false);
    });
});
