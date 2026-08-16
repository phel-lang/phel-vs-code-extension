// Pure parser for the table `phel bench` prints (`phel.bench/render-table`).
//
// The runner has no machine-readable reporter — `--store` writes a baseline of
// `{"ns/name": mean-ns}` and nothing else — so the table is the only way to get
// per-benchmark numbers back. Its shape is fixed: one header row, then one row
// per benchmark, columns padded to a common width and separated by a single
// space.
//
// Parsing splits on whitespace rather than on column offsets. Every cell the
// runner emits is a single token, and `format-duration` writes `μs` (U+03BC),
// which is one column but two bytes — a column-offset parser would have to
// agree with `mb_str_pad` about that, and would drift the moment a name grows.

export interface PhelBenchRow {
    /** `ns/name`, exactly as the runner prints it. */
    benchmark: string;
    /** Calls per measured iteration. */
    revs: number;
    /** Measured iterations. */
    its: number;
    /** Mean nanoseconds per call, whatever unit the row was printed in. */
    meanNs: number;
    /** Relative standard deviation, as a percentage. */
    rstdevPct: number;
    /** The `vs-baseline` cell verbatim: `new`, `n/a`, or a signed percentage. */
    vsBaseline: string;
}

const HEADER = ['benchmark', 'revs', 'its', 'mean', 'rstdev', 'vs-baseline'];

/**
 * Phel only ever emits `ns`, `μs` and `ms`. The rest are here because a
 * duration that arrives in a unit we reject is worse than one we convert:
 * `µs` is the Latin-1 micro sign a terminal or a locale may normalise `μs` to,
 * and `us` / `s` are what a future `format-duration` would most likely add.
 */
const NS_PER_UNIT: Record<string, number> = {
    ns: 1,
    μs: 1_000,
    µs: 1_000,
    us: 1_000,
    ms: 1_000_000,
    s: 1_000_000_000,
};

// `php/number_format` groups thousands with a comma, so a mean of one second
// prints as `1,000.000ms` and a percentage can grow a separator too.
const DURATION_RE = /^([\d,]+(?:\.\d+)?)(ns|μs|µs|us|ms|s)$/;
const RSTDEV_RE = /^±?([\d,]+(?:\.\d+)?)%$/;
const DELTA_RE = /^[+-][\d,]+(?:\.\d+)?%$/;
const COUNT_RE = /^\d+$/;

/**
 * Every benchmark row in `stdout`, in the order the runner printed them.
 *
 * Tolerant of anything around the table — a compile warning before it, the
 * `Baseline written to …` note `--store` prints after it, the regression list
 * `--tolerance` appends — because all of those are ordinary lines that simply
 * do not parse as a row. Returns an empty array when there is no table at all,
 * which is what `No benchmarks found.` and a failed compile both look like.
 */
export function parseBenchTable(stdout: string): PhelBenchRow[] {
    const rows: PhelBenchRow[] = [];
    let inTable = false;
    for (const line of stdout.split(/\r?\n/)) {
        const cells = splitCells(line);
        if (isHeader(cells)) {
            inTable = true;
            continue;
        }
        if (!inTable) {
            continue;
        }
        const row = parseRow(cells);
        if (row) {
            rows.push(row);
        } else {
            // The table ends at the first line that is not a row.
            inTable = false;
        }
    }
    return rows;
}

function splitCells(line: string): string[] {
    const trimmed = line.trim();
    return trimmed === '' ? [] : trimmed.split(/\s+/);
}

function isHeader(cells: readonly string[]): boolean {
    return cells.length === HEADER.length && HEADER.every((name, i) => cells[i] === name);
}

function parseRow(cells: readonly string[]): PhelBenchRow | null {
    if (cells.length !== HEADER.length) {
        return null;
    }
    const [benchmark, revs, its, mean, rstdev, vsBaseline] = cells;
    const duration = DURATION_RE.exec(mean);
    const spread = RSTDEV_RE.exec(rstdev);
    if (!COUNT_RE.test(revs) || !COUNT_RE.test(its) || !duration || !spread) {
        return null;
    }
    if (vsBaseline !== 'new' && vsBaseline !== 'n/a' && !DELTA_RE.test(vsBaseline)) {
        return null;
    }
    return {
        benchmark,
        revs: Number(revs),
        its: Number(its),
        meanNs: toNumber(duration[1]) * NS_PER_UNIT[duration[2]],
        rstdevPct: toNumber(spread[1]),
        vsBaseline,
    };
}

function toNumber(text: string): number {
    return Number(text.replace(/,/g, ''));
}
