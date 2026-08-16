// The fixtures below are verbatim stdout of `phel bench` (phel-lang 0.50,
// `tests/phel/bench/core.phel`), not hand-written approximations: the column
// widths, the `μs` / `±` characters and the `,`-grouped numbers PHP's
// `number_format` produces are exactly what the parser has to survive.

import * as assert from 'assert';
import { parseBenchTable } from '../phelBenchOutput';

/**
 * `phel bench tests/phel/bench/core.phel --revs=10 --iterations=2 --ref=<a
 * baseline missing one entry and holding a zero for another>` — one run that
 * happens to show all three `vs-baseline` shapes and two duration units.
 */
const MIXED_RUN = [
    'benchmark                            revs its      mean  rstdev vs-baseline',
    'phel-bench.core/bench-sort-ints        10   2   4.802μs  ±2.76%     -11.89%',
    'phel-bench.core/bench-sort-strings     10   2   2.710μs  ±0.76%         n/a',
    'phel-bench.core/bench-reduce-sum       10   2  15.283μs  ±7.13%      -4.42%',
    'phel-bench.core/bench-for-collect      10   2  11.696μs  ±1.81%      +3.45%',
    'phel-bench.core/bench-for-reduce       10   2  13.571μs  ±0.26%      -2.66%',
    'phel-bench.core/bench-into-vector      10   2   7.365μs  ±5.80%      -4.49%',
    'phel-bench.core/bench-get-in           10   2   3.238μs  ±0.18%      +1.57%',
    'phel-bench.core/bench-str-three        10   2 310.400ns  ±2.87%         new',
    'phel-bench.core/bench-hash-set-three   10   2   3.592μs ±28.71%     +25.93%',
    '',
].join('\n');

/** The same command with `--filter=sort --store=/tmp/b.json`. */
const STORE_RUN = [
    'benchmark                          revs its    mean rstdev vs-baseline',
    'phel-bench.core/bench-sort-ints      10   2 5.767μs ±5.01%         new',
    'phel-bench.core/bench-sort-strings   10   2 3.217μs ±0.37%         new',
    '',
    'Baseline written to /tmp/b.json',
    '',
].join('\n');

/** …and with `--ref=<baseline> --tolerance=1`, which appends the regressions. */
const TOLERANCE_RUN = [
    'benchmark                          revs its    mean rstdev vs-baseline',
    'phel-bench.core/bench-sort-ints      10   2 5.527μs ±2.19%      +1.41%',
    'phel-bench.core/bench-sort-strings   10   2 2.983μs ±7.51%      +6.95%',
    '',
    'Slower than the baseline by more than 1%:',
    '  phel-bench.core/bench-sort-ints +1.41%',
    '  phel-bench.core/bench-sort-strings +6.95%',
    '',
].join('\n');

/** A benchmark slow enough to be reported in milliseconds. */
const MS_RUN = [
    'benchmark                         revs its    mean rstdev vs-baseline',
    'phel-bench.tmpslow/bench-sleep-ms    1   2 3.033ms ±0.24%         new',
    '',
].join('\n');

describe('parseBenchTable', function () {
    it('reads every column of a real run', function () {
        const rows = parseBenchTable(MIXED_RUN);

        assert.strictEqual(rows.length, 9);
        assert.deepStrictEqual(rows[0], {
            benchmark: 'phel-bench.core/bench-sort-ints',
            revs: 10,
            its: 2,
            meanNs: 4802,
            rstdevPct: 2.76,
            vsBaseline: '-11.89%',
        });
    });

    it('keeps the rows in the order the runner printed them', function () {
        assert.deepStrictEqual(
            parseBenchTable(MIXED_RUN).map((r) => r.benchmark),
            [
                'phel-bench.core/bench-sort-ints',
                'phel-bench.core/bench-sort-strings',
                'phel-bench.core/bench-reduce-sum',
                'phel-bench.core/bench-for-collect',
                'phel-bench.core/bench-for-reduce',
                'phel-bench.core/bench-into-vector',
                'phel-bench.core/bench-get-in',
                'phel-bench.core/bench-str-three',
                'phel-bench.core/bench-hash-set-three',
            ]
        );
    });

    it('reports every vs-baseline shape verbatim', function () {
        const cells = new Map(parseBenchTable(MIXED_RUN).map((r) => [r.benchmark, r.vsBaseline]));

        assert.strictEqual(cells.get('phel-bench.core/bench-sort-ints'), '-11.89%');
        assert.strictEqual(cells.get('phel-bench.core/bench-for-collect'), '+3.45%');
        // No baseline entry, and a baseline entry of zero.
        assert.strictEqual(cells.get('phel-bench.core/bench-str-three'), 'new');
        assert.strictEqual(cells.get('phel-bench.core/bench-sort-strings'), 'n/a');
    });

    it('normalises every duration unit to nanoseconds', function () {
        const meanOf = (table: string, name: string): number | undefined =>
            parseBenchTable(table).find((r) => r.benchmark.endsWith(`/${name}`))?.meanNs;

        assert.strictEqual(meanOf(MIXED_RUN, 'bench-str-three'), 310.4);
        assert.strictEqual(meanOf(MIXED_RUN, 'bench-reduce-sum'), 15283);
        assert.strictEqual(meanOf(MS_RUN, 'bench-sleep-ms'), 3_033_000);
    });

    it('accepts the units the runner does not print yet', function () {
        // `format-duration` stops at `ms`; `us` is the ASCII spelling and `µs`
        // the Latin-1 micro sign a terminal may normalise `μs` to.
        const rows = parseBenchTable(
            [
                'benchmark revs its    mean rstdev vs-baseline',
                'a.b/one      1   1 2.000us ±0.00%         new',
                'a.b/two      1   1 2.000µs ±0.00%         new',
                'a.b/three    1   1  2.000s ±0.00%         new',
            ].join('\n')
        );

        assert.deepStrictEqual(
            rows.map((r) => r.meanNs),
            [2000, 2000, 2_000_000_000]
        );
    });

    it('undoes the thousands separator number_format adds', function () {
        const rows = parseBenchTable(
            [
                'benchmark revs  its        mean  rstdev vs-baseline',
                'a.b/slow  1000 1000 1,234.567ms ±10.00%  +1,000.50%',
            ].join('\n')
        );

        assert.strictEqual(rows[0].meanNs, 1_234_567_000);
        assert.strictEqual(rows[0].revs, 1000);
        assert.strictEqual(rows[0].its, 1000);
        assert.strictEqual(rows[0].vsBaseline, '+1,000.50%');
    });

    it('ignores what --store prints after the table', function () {
        const rows = parseBenchTable(STORE_RUN);

        assert.deepStrictEqual(
            rows.map((r) => r.benchmark),
            ['phel-bench.core/bench-sort-ints', 'phel-bench.core/bench-sort-strings']
        );
    });

    it('ignores the regression list --tolerance appends', function () {
        assert.strictEqual(parseBenchTable(TOLERANCE_RUN).length, 2);
    });

    it('ignores banner lines before the header', function () {
        const rows = parseBenchTable(`Some deprecation notice\n\n${MS_RUN}`);

        assert.deepStrictEqual(
            rows.map((r) => r.benchmark),
            ['phel-bench.tmpslow/bench-sleep-ms']
        );
    });

    it('reads a second table in the same output', function () {
        assert.strictEqual(parseBenchTable(`${STORE_RUN}${MS_RUN}`).length, 3);
    });

    it('returns nothing when there is no table', function () {
        assert.deepStrictEqual(parseBenchTable(''), []);
        assert.deepStrictEqual(parseBenchTable('No benchmarks found.\n'), []);
        assert.deepStrictEqual(parseBenchTable('No benchmarks found in the given paths.\n'), []);
        // A row shape without the header is not a table.
        assert.deepStrictEqual(parseBenchTable('a.b/one 1 1 2.000μs ±0.00% new\n'), []);
    });

    it('survives CRLF line endings', function () {
        assert.strictEqual(parseBenchTable(MIXED_RUN.replace(/\n/g, '\r\n')).length, 9);
    });
});
