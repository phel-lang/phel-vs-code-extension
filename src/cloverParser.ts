// Parser for the Clover XML that `phel test --coverage=clover` emits.
//
// Phel's schema (from CoverageReport::toClover):
//
//   <coverage generated="<ts>">
//     <project timestamp="<ts>">
//       <file name="<absolute .phel path>">
//         <line num="<n>" type="stmt" count="<0|1>"/>
//         ...
//         <metrics statements="<x>" coveredstatements="<y>"/>
//       </file>
//       <metrics statements="<x>" coveredstatements="<y>"/>
//     </project>
//   </coverage>
//
// `count` is binary (0 = not executed, 1 = executed) and `num` is a 1-based
// line number into the `.phel` source named by the enclosing `<file>`.

export interface CloverLine {
    /** 1-based line number. */
    line: number;
    /** True when the line was executed at least once. */
    covered: boolean;
}

export interface CloverFile {
    /** Absolute path to the covered `.phel` source. */
    file: string;
    lines: CloverLine[];
    statements: number;
    coveredStatements: number;
}

export function parseClover(xml: string): CloverFile[] {
    const files: CloverFile[] = [];
    const fileRe = /<file\b([^>]*)>([\s\S]*?)<\/file>/g;
    let m: RegExpExecArray | null;
    while ((m = fileRe.exec(xml)) !== null) {
        const name = attr(m[1], 'name');
        if (!name) {
            continue;
        }
        files.push(buildFile(decodeEntities(name), m[2]));
    }
    return files;
}

function buildFile(name: string, body: string): CloverFile {
    const lines: CloverLine[] = [];
    const lineRe = /<line\b([^>]*?)\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = lineRe.exec(body)) !== null) {
        const numRaw = attr(m[1], 'num');
        if (numRaw === undefined) {
            continue;
        }
        const line = Number.parseInt(numRaw, 10);
        if (!Number.isFinite(line)) {
            continue;
        }
        const count = Number.parseInt(attr(m[1], 'count') ?? '0', 10);
        lines.push({ line, covered: Number.isFinite(count) && count > 0 });
    }

    // The file-level <metrics> is the last metrics element inside <file>.
    const metrics = lastMetrics(body);
    return {
        file: name,
        lines,
        statements: metrics.statements ?? lines.length,
        coveredStatements: metrics.coveredStatements ?? lines.filter((l) => l.covered).length,
    };
}

function lastMetrics(body: string): { statements?: number; coveredStatements?: number } {
    const re = /<metrics\b([^>]*?)\/?>/g;
    let last: string | undefined;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
        last = m[1];
    }
    if (last === undefined) {
        return {};
    }
    const statements = toInt(attr(last, 'statements'));
    const coveredStatements = toInt(attr(last, 'coveredstatements'));
    return { statements, coveredStatements };
}

function toInt(value: string | undefined): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : undefined;
}

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
        .replace(/&amp;/g, '&');
}
