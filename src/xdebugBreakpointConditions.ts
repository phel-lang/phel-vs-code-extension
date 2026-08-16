// Everything a breakpoint carries beyond "file and line": the condition, the
// hit count, and the log message — plus the Phel → PHP name translation all
// three (and the evaluate path) need.
//
// Xdebug evaluates a breakpoint condition as PHP, in the frame the engine is
// about to stop in, so a condition written in Phel has to name the *PHP*
// variable the compiler emitted. That name comes from `Munge` in phel-lang
// (`src/php/Shared/Munge.php`): every character outside `[A-Za-z0-9_]` is
// replaced by a spelled-out token, so `blank?` is `$blank_QMARK_` and `foo-bar`
// is `$foo_bar`. `SYMBOL_MAPPING` below is that table, verbatim.
//
// Split out of the debug adapter because `PhelDebugSession` cannot be
// constructed outside a live debug session; all of this is pure, so it can be
// tested.

/** `Munge::SYMBOL_MAPPING` from phel-lang, in the same order. */
const SYMBOL_MAPPING: ReadonlyArray<readonly [string, string]> = [
    ['-', '_'],
    ['.', '_DOT_'],
    [':', '_COLON_'],
    ['+', '_PLUS_'],
    ['>', '_GT_'],
    ['<', '_LT_'],
    ['=', '_EQ_'],
    ['~', '_TILDE_'],
    ['!', '_BANG_'],
    ['@', '_CIRCA_'],
    ['#', '_SHARP_'],
    ["'", '_SINGLEQUOTE_'],
    ['"', '_DOUBLEQUOTE_'],
    ['%', '_PERCENT_'],
    ['^', '_CARET_'],
    ['&', '_AMPERSAND_'],
    ['*', '_STAR_'],
    ['|', '_BAR_'],
    ['{', '_LBRACE_'],
    ['}', '_RBRACE_'],
    ['[', '_LBRACK_'],
    [']', '_RBRACK_'],
    ['/', '_SLASH_'],
    ['\\', '_BSLASH_'],
    ['?', '_QMARK_'],
    ['$', '_DOLLAR_'],
];

const SYMBOL_TABLE = new Map(SYMBOL_MAPPING);

/**
 * A Phel name as the compiler spells it in PHP, without the `$`.
 *
 * `this` is special-cased in `Munge::encode` because PHP owns that variable
 * name; everything else is a per-character substitution.
 */
export function mungeName(name: string): string {
    if (name === 'this') {
        return '__phel_this';
    }
    let out = '';
    for (const ch of name) {
        out += SYMBOL_TABLE.get(ch) ?? ch;
    }
    return out;
}

/** Names that mean something in PHP already and must survive untouched. */
const PHP_WORDS = new Set([
    'true',
    'false',
    'null',
    'and',
    'or',
    'xor',
    'new',
    'clone',
    'instanceof',
    'isset',
    'empty',
    'array',
    'fn',
    'function',
    'match',
    'return',
]);

const IDENT_START = /[A-Za-z_]/;
const IDENT_BODY = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

/**
 * Rewrite a Phel expression into the PHP Xdebug can evaluate.
 *
 * Bare Phel names become the munged local (`blank?` → `$blank_QMARK_`),
 * keywords become the runtime object (`:done` → `\Phel\Lang\Keyword::create("done")`),
 * and anything already PHP — a `$variable`, a call, a string, an operator, a
 * `Class::CONST` — is copied through untouched. A name directly followed by `(`
 * is a call, so it keeps its own spelling.
 *
 * `munge` is injectable so a test can pin the mapping against phel-lang's own
 * table without going through this scanner.
 */
export function phelExpressionToPhp(
    expression: string,
    munge: (name: string) => string = mungeName
): string {
    const src = expression.trim();
    let out = '';
    let i = 0;

    while (i < src.length) {
        const ch = src[i];

        // Strings are opaque: whatever is inside is data, not a name.
        if (ch === '"' || ch === "'") {
            const end = endOfString(src, i);
            out += src.slice(i, end);
            i = end;
            continue;
        }

        // Already a PHP variable, a namespace, a member or a static access —
        // the name that follows belongs to PHP, so it is copied verbatim.
        const passthrough = leadingPassthrough(src, i);
        if (passthrough) {
            const after = i + passthrough.length;
            const end = endOfPhpIdentifier(src, after);
            out += src.slice(i, end);
            i = end;
            continue;
        }

        if (ch === ':') {
            const end = endOfKeywordName(src, i + 1);
            if (end > i + 1) {
                out += keywordExpression(src.slice(i + 1, end));
                i = end;
                continue;
            }
        }

        // A number, so that `1e5` or `0x1f` is not read as a name.
        if (DIGIT.test(ch)) {
            const end = endOfNumber(src, i);
            out += src.slice(i, end);
            i = end;
            continue;
        }

        if (IDENT_START.test(ch)) {
            const end = endOfPhelName(src, i);
            const name = src.slice(i, end);
            out += translateName(name, src, end, munge);
            i = end;
            continue;
        }

        out += ch;
        i += 1;
    }

    return out;
}

/** Phel's `nil` is PHP's `null`; PHP's own words stay as they are. */
function translateName(
    name: string,
    src: string,
    end: number,
    munge: (name: string) => string
): string {
    if (name === 'nil') {
        return 'null';
    }
    if (PHP_WORDS.has(name.toLowerCase())) {
        return name;
    }
    // `count(xs)` calls PHP's `count` and `Foo::BAR` names a class constant;
    // only what stands on its own is a local.
    const rest = src.slice(end).trimStart();
    if (rest.startsWith('(') || rest.startsWith('::') || rest.startsWith('->')) {
        return name;
    }
    return '$' + munge(name);
}

/**
 * `Keyword`'s constructor is private, so a keyword has to be built through the
 * factory. A qualified keyword carries its namespace separately.
 */
function keywordExpression(name: string): string {
    const slash = name.indexOf('/');
    if (slash > 0) {
        return `\\Phel\\Lang\\Keyword::create(${quote(name.slice(slash + 1))}, ${quote(
            name.slice(0, slash)
        )})`;
    }
    return `\\Phel\\Lang\\Keyword::create(${quote(name)})`;
}

function quote(value: string): string {
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** `$`, `\`, `->` or `::` at `i`, whichever introduces a PHP name. */
function leadingPassthrough(src: string, i: number): string | null {
    if (src[i] === '$' || src[i] === '\\') {
        return src[i];
    }
    const pair = src.slice(i, i + 2);
    return pair === '->' || pair === '::' ? pair : null;
}

function endOfPhpIdentifier(src: string, i: number): number {
    let end = i;
    while (end < src.length && IDENT_BODY.test(src[end])) {
        end += 1;
    }
    return end;
}

/**
 * The end of the Phel name starting at `i`.
 *
 * `-` continues a name only when a name character follows it, so `x->y` and
 * `a - b` keep their operators. The `?` / `!` suffixes are taken only where
 * they cannot be the start of a PHP operator (`??`, `?:`, `!=`).
 */
function endOfPhelName(src: string, i: number): number {
    if (i >= src.length || !IDENT_START.test(src[i])) {
        return i;
    }
    let end = i + 1;
    while (end < src.length) {
        const ch = src[end];
        const next = src[end + 1];
        if (IDENT_BODY.test(ch)) {
            end += 1;
            continue;
        }
        if (ch === '-' && next !== undefined && IDENT_BODY.test(next)) {
            end += 1;
            continue;
        }
        if (ch === '?' && next !== '?' && next !== ':' && next !== '=') {
            end += 1;
            continue;
        }
        if (ch === '!' && next !== '=') {
            end += 1;
            continue;
        }
        break;
    }
    return end;
}

/** A keyword's name, which may carry a namespace: `:app/state`. */
function endOfKeywordName(src: string, i: number): number {
    const end = endOfPhelName(src, i);
    if (end > i && src[end] === '/') {
        const qualified = endOfPhelName(src, end + 1);
        if (qualified > end + 1) {
            return qualified;
        }
    }
    return end;
}

function endOfNumber(src: string, i: number): number {
    let end = i;
    while (end < src.length && /[0-9A-Za-z_.]/.test(src[end])) {
        end += 1;
    }
    return end;
}

function endOfString(src: string, i: number): number {
    const quoteChar = src[i];
    let end = i + 1;
    while (end < src.length) {
        if (src[end] === '\\') {
            end += 2;
            continue;
        }
        if (src[end] === quoteChar) {
            return end + 1;
        }
        end += 1;
    }
    return src.length;
}

/** DBGp's `-o` operators for a hit count. */
export type HitOperator = '>=' | '==' | '%';

export interface HitCondition {
    op: HitOperator;
    value: number;
}

/**
 * VS Code's hit-count expression as DBGp's `-h` / `-o` pair.
 *
 * The editor accepts free text here, so anything that is not one of the shapes
 * Xdebug understands is `null` — the caller then installs a plain breakpoint
 * rather than one the engine would reject. A bare number means "from the nth
 * hit on", which is what the debug UI documents.
 */
export function parseHitCondition(text: string | undefined): HitCondition | null {
    if (!text) {
        return null;
    }
    const match = /^\s*(>=|==|=|>|%)?\s*(\d+)\s*$/.exec(text);
    if (!match) {
        return null;
    }
    const value = Number(match[2]);
    if (value < 1) {
        return null;
    }
    switch (match[1]) {
        case '==':
        case '=':
            return { op: '==', value };
        case '%':
            return { op: '%', value };
        case '>':
            // DBGp has no `>`; "after n hits" is "from hit n + 1 on".
            return { op: '>=', value: value + 1 };
        default:
            return { op: '>=', value };
    }
}

export interface BreakpointOptions {
    /** Phel (or PHP) expression the engine has to find truthy to stop. */
    condition?: string;
    /** VS Code's hit-count expression, e.g. `>= 3`. */
    hitCondition?: string;
}

export interface DbgpBreakpointCommand {
    /** `breakpoint_set` arguments, without the transaction id. */
    args: Record<string, string>;
    /** The condition, sent as the (base64) data payload DBGp expects. */
    data?: string;
}

/**
 * The `breakpoint_set` a breakpoint at `fileUri:line` needs.
 *
 * DBGp carries the expression of a `conditional` breakpoint in the data
 * payload, never as an argument; the hit count is `-h <n> -o <op>` on either
 * breakpoint type.
 */
export function breakpointSetArgs(
    fileUri: string,
    line: number,
    options: BreakpointOptions = {}
): DbgpBreakpointCommand {
    const condition = options.condition?.trim();
    const hit = parseHitCondition(options.hitCondition);

    const args: Record<string, string> = {
        t: condition ? 'conditional' : 'line',
        f: fileUri,
        n: String(line),
    };
    if (hit) {
        args.h = String(hit.value);
        args.o = hit.op;
    }

    return condition ? { args, data: phelExpressionToPhp(condition) } : { args };
}

export type LogSegment = { kind: 'text'; value: string } | { kind: 'expression'; value: string };

/**
 * Split a logpoint message into its literal and `{expression}` parts.
 *
 * `\{` and `\}` escape a brace, and an unclosed `{` is literal text — a
 * logpoint that reads like a typo should print, not fail.
 */
export function parseLogMessage(template: string): LogSegment[] {
    const segments: LogSegment[] = [];
    let text = '';
    let i = 0;

    const flush = (): void => {
        if (text.length > 0) {
            segments.push({ kind: 'text', value: text });
            text = '';
        }
    };

    while (i < template.length) {
        const ch = template[i];
        if (ch === '\\' && (template[i + 1] === '{' || template[i + 1] === '}')) {
            text += template[i + 1];
            i += 2;
            continue;
        }
        if (ch === '{') {
            const close = template.indexOf('}', i + 1);
            if (close < 0) {
                text += template.slice(i);
                break;
            }
            const expression = template.slice(i + 1, close).trim();
            if (expression.length > 0) {
                flush();
                segments.push({ kind: 'expression', value: expression });
            }
            i = close + 1;
            continue;
        }
        text += ch;
        i += 1;
    }

    flush();
    return segments;
}

/**
 * A logpoint's message with every `{expression}` replaced by what `evaluate`
 * answers for it. Evaluation is sequential: each one is a round trip to the
 * engine, which only handles one command at a time.
 */
export async function interpolateLogMessage(
    template: string,
    evaluate: (expression: string) => Promise<string>
): Promise<string> {
    let out = '';
    for (const segment of parseLogMessage(template)) {
        out += segment.kind === 'text' ? segment.value : await evaluate(segment.value);
    }
    return out;
}

export interface BreakpointLocation {
    /** The compiled PHP file this breakpoint was installed in. */
    phpFile: string | null;
    /** Every PHP line installed for it — a Phel line can compile to several. */
    phpLines: readonly number[];
}

/**
 * The breakpoint the engine stopped on, out of everything we installed.
 *
 * Xdebug names the file and line it stopped at, not the breakpoint id, so this
 * is what tells a logpoint apart from an ordinary breakpoint. Both sides are
 * expected to be resolved paths already; the comparison only normalises
 * separators (and case, where the filesystem does).
 */
export function matchBreakpoint<T extends BreakpointLocation>(
    breakpoints: Iterable<T>,
    phpFile: string,
    phpLine: number
): T | undefined {
    const wanted = comparablePath(phpFile);
    for (const breakpoint of breakpoints) {
        if (breakpoint.phpFile === null || comparablePath(breakpoint.phpFile) !== wanted) {
            continue;
        }
        if (breakpoint.phpLines.includes(phpLine)) {
            return breakpoint;
        }
    }
    return undefined;
}

function comparablePath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
