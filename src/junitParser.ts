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
    // Self-closing testcases (no failure/error child).
    const selfClosingRe = /<testcase\b([^>]*?)\/>/g;
    // Testcases with a body (may contain failure/error children).
    const bodyRe = /<testcase\b([^>]*?)>([\s\S]*?)<\/testcase>/g;

    let m: RegExpExecArray | null;
    while ((m = bodyRe.exec(scope)) !== null) {
        out.push(buildCase(m[1], m[2], suiteName));
    }
    while ((m = selfClosingRe.exec(scope)) !== null) {
        out.push(buildCase(m[1], '', suiteName));
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

/** Read a double- or single-quoted attribute value (raw, not entity-decoded). */
function attr(attrs: string, name: string): string | undefined {
    const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`);
    const m = re.exec(attrs);
    if (!m) {
        return undefined;
    }
    return m[2] ?? m[3] ?? '';
}

function decodeEntities(text: string): string {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
            String.fromCodePoint(Number.parseInt(code, 16))
        )
        .replace(/&amp;/g, '&'); // last, so we don't double-decode
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
