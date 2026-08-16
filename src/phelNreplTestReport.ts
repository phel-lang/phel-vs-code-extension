// Reading what a `run-tests` op said.
//
// Phel's nREPL `run-tests` op evaluates `(phel.repl/run-tests 'ns)` — or
// `(phel.repl/run-test 'ns/var)` when a `var` param is set — and answers with
// two things: a `value` frame holding the summary map the function returns,
// `{:pass 1, :fail 1, :error 0}`, and an `out` frame holding whatever the
// default reporter printed on the way. There are no per-assertion frames, so
// the verdict comes from the summary and the detail from the printed report.
//
// The reporter (`src/phel/test.phel`) prints one block per failing assertion,
// separated by `~~~~~~~~~~`, each opening with a headline:
//
//   FAIL <test-name> ['<message>'] (<basename>:<line>)
//   ERROR <test-name> ['<message>'] (<basename>:<line>)
//
// followed by right-aligned `label: value` lines whose padding varies with the
// failure type, and optionally a `Diff:` / `String diff (…)` block. Only the
// headline is anchored on; everything after it is read as labelled lines until
// the next separator or the blank line before the counts, which is what keeps a
// verbose run (or a test that prints) from being mistaken for a report.
//
// Two things the reporter does that are worth knowing when reading a location:
// the file is a basename (`php/basename`), so it only identifies a file
// together with the namespace that was run; and the line is the enclosing
// `(deftest …)` form's, not the failing `(is …)`'s — every assertion in a test
// reports the same line, because the assertion forms inherit the location of
// the form the `deftest` macro rebuilt them into.
//
// No `vscode` import: this is a parser, and it is unit-tested against output
// captured verbatim from a real server.

/** What `(phel.repl/run-tests …)` returns, per assertion rather than per test. */
export interface PhelTestSummary {
    pass: number;
    fail: number;
    error: number;
}

/** `FAIL` is a failed assertion, `ERROR` an assertion that threw. */
export type PhelTestFailureKind = 'FAIL' | 'ERROR';

export interface PhelTestFailure {
    kind: PhelTestFailureKind;
    /** The `deftest` name, as the reporter printed it. */
    testName: string;
    /** The optional message argument of the `is` form. */
    message?: string;
    /** Basename of the file the assertion is in; never a path. */
    file?: string;
    /** 1-based, and the `deftest`'s line rather than the assertion's (see above). */
    line?: number;
    /** The form whose value was asserted on. */
    form?: string;
    /** What that form evaluated to. */
    actual?: string;
    /** What it should have evaluated to, or the exception that should have been thrown. */
    expected?: string;
    /** The predicate the assertion compared with (`=`, `pos?`, …). */
    pred?: string;
    /** Every line of the block below the headline, verbatim. */
    detail: string;
}

/** A headline starts at column 0; every other line of a block is indented. */
const HEADLINE_RE = /^(FAIL|ERROR)(?:\s(.*))?$/;
/** What `print-failures-block` writes between two blocks. */
const SEPARATOR_RE = /^~{3,}$/;
/** ` (basename.phel:12)` at the end of a headline. */
const LOCATION_RE = /\s*\(([^()]*):(\d+)\)\s*$/;
/** ` 'the message'` at the end of a headline, once the location is off. */
const MESSAGE_RE = /\s*'(.*)'\s*$/;
/** The opening line of a `Diff:` or `String diff (…):` block. */
const DIFF_HEAD_RE = /^\s*(Diff:|String diff\b)/;
/** `  evaluated to: 42` — the label's padding is right-aligned, so it varies. */
const LABEL_RE = /^\s+([A-Za-z][A-Za-z' ]*):\s?(.*)$/;
/** `= to "expected"`, the tail of a `but is not:` / `but is:` line. */
const PRED_TO_RE = /^(\S+)\s+to\s+([\s\S]*)$/;

const PASS_RE = /:pass\s+(\d+)/;
const FAIL_RE = /:fail\s+(\d+)/;
const ERROR_RE = /:error\s+(\d+)/;

/**
 * The `{:pass n :fail n :error n}` map a `run-tests` op returns, or null when
 * the value is not one — an op that errored answers with a stack trace instead.
 */
export function parseRunTestsSummary(value: string): PhelTestSummary | null {
    if (!value.includes('{')) {
        return null;
    }
    const pass = PASS_RE.exec(value);
    const fail = FAIL_RE.exec(value);
    const error = ERROR_RE.exec(value);
    if (!pass || !fail || !error) {
        return null;
    }
    return {
        pass: Number.parseInt(pass[1], 10),
        fail: Number.parseInt(fail[1], 10),
        error: Number.parseInt(error[1], 10),
    };
}

/** Every failing assertion the default reporter printed into `out`. */
export function parseTestReport(out: string): PhelTestFailure[] {
    const failures: PhelTestFailure[] = [];
    let current: PhelTestFailure | undefined;
    let detail: string[] = [];
    /** Inside a diff block, whose own `expected:` / `actual:` lines are windowed. */
    let inDiff = false;

    const close = (): void => {
        if (current) {
            current.detail = detail.join('\n');
            failures.push(current);
            current = undefined;
        }
    };

    for (const line of out.split(/\r?\n/)) {
        const headline = HEADLINE_RE.exec(line);
        if (headline) {
            close();
            current = headlineOf(headline[1] as PhelTestFailureKind, headline[2] ?? '');
            detail = [];
            inDiff = false;
            continue;
        }
        if (!current) {
            continue;
        }
        if (line.trim() === '' || SEPARATOR_RE.test(line.trim())) {
            close();
            continue;
        }
        detail.push(line);
        if (DIFF_HEAD_RE.test(line)) {
            // The rendering of a difference already reported above it: its
            // `expected:` / `actual:` rows are windowed and escaped, so reading
            // fields back out of them would replace the values with excerpts.
            inDiff = true;
            continue;
        }
        if (!inDiff) {
            applyLabel(current, line);
        }
    }
    close();
    return failures;
}

/** `t-shout 'a message' (file.phel:8)` — every part after the prefix is optional. */
function headlineOf(kind: PhelTestFailureKind, tail: string): PhelTestFailure {
    const failure: PhelTestFailure = { kind, testName: '', detail: '' };
    let rest = tail;
    const location = LOCATION_RE.exec(rest);
    if (location) {
        failure.file = location[1];
        failure.line = Number.parseInt(location[2], 10);
        rest = rest.slice(0, location.index);
    }
    const message = MESSAGE_RE.exec(rest);
    if (message) {
        failure.message = message[1];
        rest = rest.slice(0, message.index);
    }
    failure.testName = rest.trim();
    return failure;
}

function applyLabel(failure: PhelTestFailure, line: string): void {
    const match = LABEL_RE.exec(line);
    if (!match) {
        return;
    }
    const value = match[2].trim();
    switch (match[1].trim()) {
        case 'Form':
        case 'expected':
            failure.form ??= value;
            break;
        case 'evaluated to':
            failure.actual = strip(value, '(which is not truthy)');
            break;
        case 'but is not':
            binary(failure, value);
            break;
        case 'but is':
            binary(failure, strip(value, "(it shouldn't be)"));
            break;
        case "but doesn't satisfy":
            failure.pred = value;
            break;
        case 'but does satisfy':
            failure.pred = strip(value, "(it shouldn't)");
            break;
        case 'to throw a':
            failure.expected = strip(value, "(it didn't)");
            break;
        case 'with message':
            // On an ERROR this is the exception's own message, which belongs
            // with `threw` in the detail rather than in an expected/actual pair.
            if (failure.kind === 'FAIL') {
                failure.expected = value;
            }
            break;
        case 'but got':
            failure.actual = value;
            break;
        case 'threw':
            failure.actual = value;
            break;
        default:
            break;
    }
}

/** `= to "expected"` — the predicate and the value it compared against. */
function binary(failure: PhelTestFailure, value: string): void {
    const match = PRED_TO_RE.exec(value);
    if (match) {
        failure.pred = match[1];
        failure.expected = match[2].trim();
    } else {
        failure.expected = value;
    }
}

function strip(value: string, suffix: string): string {
    return value.endsWith(suffix) ? value.slice(0, -suffix.length).trimEnd() : value;
}
