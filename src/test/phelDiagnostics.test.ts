import * as assert from 'assert';
import { parsePhelAnalyzeOutput, toZeroBasedRange, PhelDiagnostic } from '../phelDiagnostics';

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
