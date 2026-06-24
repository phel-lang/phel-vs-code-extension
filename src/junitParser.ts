// Parser for the JUnit XML that `phel test --reporter=junit-xml` emits.
//
// Phel's schema (verified against the CLI):
//
//   <testsuites tests= failures= errors= time=>
//     <testsuite name="<namespace>" ...>
//       <testcase name="<deftest>" classname="" file="<abs path>" line="<n>">
//         <failure message="<msg>" type="<type>"><failing form></failure>?
//         <error   message="<msg>" type="<type>">...</error>?
//       </testcase>
//       ...
//     </testsuite>
//   </testsuites>
//
// One `<testcase>` is emitted per assertion, so a single `deftest` produces
// several rows that share `name`/`file`/`line`; rows carry a `<failure>` only
// when that assertion failed. Callers aggregate by name (see groupByName).

import { decodeEntities, readAttr as attr } from './xml';

export interface JUnitFailure {
    message: string;
    type: string;
    /** Text content of the failure element (the failing form, for Phel). */
    detail: string;
    /** True for `<error>` (a thrown exception) rather than `<failure>`. */
    isError: boolean;
}

export interface JUnitTestCase {
    name: string;
    suite: string;
    file?: string;
    line?: number;
    failures: JUnitFailure[];
}

/** All testcases flattened across suites, in document order. */
export function parseJUnit(xml: string): JUnitTestCase[] {
    const cases: JUnitTestCase[] = [];
    const suiteRe = /<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/g;
    let suiteMatch: RegExpExecArray | null;
    let matchedAnySuite = false;
    while ((suiteMatch = suiteRe.exec(xml)) !== null) {
        matchedAnySuite = true;
        const suiteName = attr(suiteMatch[1], 'name') ?? '';
        collectCases(suiteMatch[2], suiteName, cases);
    }
    // Some reporters omit <testsuite> and put <testcase> directly under
    // <testsuites>; handle that by scanning the whole doc as a fallback.
    if (!matchedAnySuite) {
        collectCases(xml, '', cases);
    }
    return cases;
}

function collectCases(scope: string, suiteName: string, out: JUnitTestCase[]): void {
    // Match self-closing (`<testcase .../>`) and body (`<testcase ...>...</testcase>`)
    // forms in a single left-to-right pass so document order is preserved and a
    // self-closing element can't be swallowed by a following element's body.
    const re = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(scope)) !== null) {
        out.push(buildCase(m[1], m[2] ?? '', suiteName));
    }
}

function buildCase(attrs: string, body: string, suiteName: string): JUnitTestCase {
    const lineRaw = attr(attrs, 'line');
    const line = lineRaw !== undefined ? Number.parseInt(lineRaw, 10) : undefined;
    return {
        name: attr(attrs, 'name') ?? '',
        suite: suiteName,
        file: attr(attrs, 'file'),
        line: line !== undefined && Number.isFinite(line) ? line : undefined,
        failures: parseFailures(body),
    };
}

function parseFailures(body: string): JUnitFailure[] {
    const failures: JUnitFailure[] = [];
    const re = /<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
        failures.push({
            isError: m[1] === 'error',
            message: decodeEntities(attr(m[2], 'message') ?? ''),
            type: decodeEntities(attr(m[2], 'type') ?? ''),
            detail: decodeEntities((m[3] ?? '').trim()),
        });
    }
    return failures;
}

export interface AggregatedCase {
    name: string;
    suite: string;
    file?: string;
    line?: number;
    failures: JUnitFailure[];
    passed: boolean;
}

/**
 * Collapse the per-assertion rows into one entry per test name (within a
 * suite). A test passes only if none of its rows carried a failure/error.
 */
export function groupByName(cases: JUnitTestCase[]): Map<string, AggregatedCase> {
    const byKey = new Map<string, AggregatedCase>();
    for (const c of cases) {
        const key = `${c.suite}::${c.name}`;
        const existing = byKey.get(key);
        if (existing) {
            existing.failures.push(...c.failures);
            existing.passed &&= c.failures.length === 0;
            existing.file ??= c.file;
            existing.line ??= c.line;
        } else {
            byKey.set(key, {
                name: c.name,
                suite: c.suite,
                file: c.file,
                line: c.line,
                failures: [...c.failures],
                passed: c.failures.length === 0,
            });
        }
    }
    return byKey;
}
