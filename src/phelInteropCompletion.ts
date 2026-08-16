// PHP-interop completion, as `phel api-daemon` answers it.
//
// The bundled provider knows `phel.core` and the workspace; what it cannot know
// is PHP. `completeAtPoint {source, line, col}` can: the daemon resolves the
// receiver of a `php/->` / `php/::` form, reflects over the class, and answers
// with the members, the global functions, the classes on the composer classmap
// or the superglobals - none of which is in any `.phel` file.
//
// Two pieces live here. `isInteropCompletionPosition` mirrors every position
// `PhpInteropContextResolver` recognises, so a keystroke that cannot
// possibly be an interop one never reaches the daemon: everywhere else the
// daemon answers with *Phel* completion (locals, project defs, all of
// `phel.core`), which is precisely what the bundled provider already offers.
// `toCompletionSpecs` maps what comes back, and drops anything whose shape is
// not an interop one - the daemon falls through to that same Phel list when the
// receiver's type turns out to be unknown, and a second copy of the core list
// is the one outcome worse than no interop completion at all.
//
// Kept free of `vscode` imports so both halves are unit-testable.

/** One `Completion` transfer object, as the daemon serialises it. */
export interface DaemonCompletion {
    label: string;
    /** `local` | `global` | `require` | `macro` | `keyword` | `variable`. */
    kind: string;
    /** A rendered signature (`name(params): ret`), `class`, `PHP superglobal`, … */
    detail: string;
    documentation: string;
}

/**
 * What an interop item is, in the editor's terms. A plain union rather than a
 * `vscode.CompletionItemKind` so this module stays importable outside a host;
 * the provider maps it.
 */
export type InteropItemKind =
    | 'method'
    | 'function'
    | 'class'
    | 'property'
    | 'constant'
    | 'variable';

/** One completion item, ready for the provider to turn into a `CompletionItem`. */
export interface InteropCompletionSpec {
    label: string;
    kind: InteropItemKind;
    detail: string;
    /** Markdown; `''` when the daemon had nothing to say beyond the detail. */
    documentation: string;
    /** Only where the label alone would not be written verbatim. */
    insertText?: string;
    /** `0…`, so what only the compiler knows leads in an interop position. */
    sortText: string;
}

/**
 * The `php/<name>` interop special forms. They are Phel forms, not PHP
 * functions, so `php/new` is not a position where PHP globals belong -
 * `PhpInteropContextResolver::INTEROP_SPECIAL_FORMS`, verbatim.
 */
const INTEROP_SPECIAL_FORMS = new Set([
    'new',
    'aget',
    'aset',
    'apush',
    'aunset',
    'ref',
    'callable',
    'oset',
]);

/** `(php/-> receiver method|` and `(php/-> receiver (method|`. */
const INSTANCE_MEMBER_RE = /\(\s*php\/->\s+(.+?)\s+\(?[A-Za-z0-9_]*$/s;
/** `(php/:: Class method|` and `(php/:: Class (method|`. */
const STATIC_MEMBER_RE = /\(\s*php\/::\s+(.+?)\s+\(?[A-Za-z0-9_]*$/s;
/** `\Foo/member|`, the source spelling of `php/::`; `$member` is a static property. */
const CLASS_MEMBER_RE = /(?:^|[\s([{])(\\?[A-Za-z_][A-Za-z0-9_\\.]*)\/\$?\w*$/;
/** `(.method receiver|` and `(.-field receiver|`. */
const DOT_MEMBER_RE = /\(\s*\.-?\w*$/;
/** `(php/new \Foo|`. */
const PHP_NEW_RE = /\(\s*php\/new\s+\\?[A-Za-z0-9_\\]*$/;
/** A fully-qualified `\Foo\Bar` anywhere. */
const CLASS_NAME_RE = /\\[A-Za-z0-9_\\]*$/;
/** `php/$_SERVER`: a PHP variable, whose name carries the sigil. */
const GLOBAL_VARIABLE_RE = /(?:^|[\s([{])php\/\$\w*$/;
/** `php/<fn>`, a PHP global function. */
const GLOBAL_FUNCTION_RE = /(?:^|[\s([{])php\/(\w+)$/;

/** The token the daemon's label replaces: what was typed of the member itself. */
const REPLACED_TOKEN_RE = /[A-Za-z0-9_$\\]*$/;

/** `class`, and the three other things `\Foo` can name. */
const CLASS_DETAILS = new Set(['class', 'interface', 'enum', 'trait']);

/** The details the reflector writes where it has no signature to render. */
const PLAIN_DETAILS = new Set(['function', 'constant', 'enum case', 'PHP superglobal']);

/** `name(` - the head of a rendered method or function signature. */
const SIGNATURE_RE = /^[A-Za-z_]\w*\(/;

/**
 * Whether the cursor sits where the daemon could have PHP to offer, judged from
 * the line up to it.
 *
 * This mirrors `PhpInteropContextResolver::resolve` on one line rather than on
 * the whole enclosing form: it is a gate on the keystroke path, and a
 * `(php/-> recv` whose member is typed on the *next* line only misses the
 * daemon's answer, never gets a wrong one. The daemon re-decides on the full
 * source either way.
 */
export function isInteropCompletionPosition(linePrefix: string): boolean {
    // Interop-looking text inside a string or a `;` comment (a `\Foo` in a
    // docstring) is not an interop position.
    if (inStringOrComment(linePrefix)) {
        return false;
    }
    if (
        INSTANCE_MEMBER_RE.test(linePrefix) ||
        STATIC_MEMBER_RE.test(linePrefix) ||
        DOT_MEMBER_RE.test(linePrefix) ||
        PHP_NEW_RE.test(linePrefix) ||
        CLASS_NAME_RE.test(linePrefix) ||
        GLOBAL_VARIABLE_RE.test(linePrefix)
    ) {
        return true;
    }
    // `Foo/bar` is a class member only when `Foo` names a class: the analyzer's
    // rule (an initial capital or a leading `\`), which is also what keeps a
    // Phel `str/join` on the bundled provider's alias-qualified path.
    const member = CLASS_MEMBER_RE.exec(linePrefix);
    if (member && isClassReference(member[1])) {
        return true;
    }
    const global = GLOBAL_FUNCTION_RE.exec(linePrefix);
    return global !== null && !INTEROP_SPECIAL_FORMS.has(global[1]);
}

/**
 * How many characters before the cursor the daemon's label replaces.
 *
 * The editor's own word range is useless here: the `phel` word pattern makes
 * `php/strto` one word, so an unranged item would overwrite the `php/` prefix
 * it was offered for. A leading `\` is left in place instead - class labels are
 * fully qualified but unrooted (`Symfony\Component\Console\Input\ArgvInput`),
 * so `\Symfony\Comp` keeps its backslash and replaces the rest.
 */
export function replacedTokenLength(linePrefix: string): number {
    const token = REPLACED_TOKEN_RE.exec(linePrefix)?.[0] ?? '';
    return token.startsWith('\\') ? token.length - 1 : token.length;
}

/** Read a daemon answer as completion items; `[]` when it is not a list of them. */
export function parseCompletionResult(result: unknown): DaemonCompletion[] {
    if (!Array.isArray(result)) {
        return [];
    }
    const out: DaemonCompletion[] = [];
    for (const entry of result) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            continue;
        }
        const record = entry as Record<string, unknown>;
        if (typeof record.label !== 'string' || record.label === '') {
            continue;
        }
        out.push({
            label: record.label,
            kind: stringValue(record.kind),
            detail: stringValue(record.detail),
            documentation: stringValue(record.documentation),
        });
    }
    return out;
}

/**
 * The items to show for `items`, in the order the daemon listed them.
 *
 * Anything that is not a PHP symbol is dropped here: the daemon answers a
 * position it does not recognise - or one whose receiver it could not type -
 * with Phel locals, project definitions and the whole of `phel.core`, and this
 * provider sits next to the one that already offers those.
 */
export function toCompletionSpecs(items: readonly DaemonCompletion[]): InteropCompletionSpec[] {
    const specs: InteropCompletionSpec[] = [];
    for (const item of items) {
        if (!isInteropItem(item)) {
            continue;
        }
        const kind = kindOf(item);
        specs.push({
            label: item.label,
            kind,
            detail: item.detail,
            documentation: documentationFor(item),
            // A variable's name carries its `$`, and an editor that word-breaks
            // on the sigil would otherwise write only what follows it.
            ...(kind === 'variable' ? { insertText: item.label } : {}),
            sortText: `0_${item.label}`,
        });
    }
    return specs;
}

/**
 * Which of the six kinds `item` is. The daemon's own kinds are Phel's
 * (`macro`, `global`, …), so a method arrives as a macro and a class and a
 * function both as globals; the detail is what tells the last two apart.
 */
function kindOf(item: DaemonCompletion): InteropItemKind {
    switch (item.kind) {
        case 'macro':
            return 'method';
        case 'local':
            return 'property';
        case 'keyword':
            return 'constant';
        case 'variable':
            return 'variable';
        default:
            return CLASS_DETAILS.has(item.detail) ? 'class' : 'function';
    }
}

/**
 * What the popup shows under the label. The daemon has no signature-help
 * method, so a method's signature is repeated here as well as in the detail:
 * this popup is the only place a caller ever sees it.
 */
function documentationFor(item: DaemonCompletion): string {
    if (!SIGNATURE_RE.test(item.detail)) {
        return item.documentation;
    }
    const signature = `\`\`\`php\n${item.detail}\n\`\`\``;
    return item.documentation ? `${signature}\n\n${item.documentation}` : signature;
}

/** Whether `item` describes a PHP symbol rather than a Phel one. */
function isInteropItem(item: DaemonCompletion): boolean {
    return (
        CLASS_DETAILS.has(item.detail) ||
        PLAIN_DETAILS.has(item.detail) ||
        // `int property`, `?DateTimeZone static property`.
        item.detail.endsWith(' property') ||
        SIGNATURE_RE.test(item.detail)
    );
}

/** A namespace part that names a PHP class rather than a Phel namespace. */
function isClassReference(token: string): boolean {
    if (token === '' || token === 'php') {
        return false;
    }
    return token.startsWith('\\') || (token[0] >= 'A' && token[0] <= 'Z');
}

/**
 * Whether the cursor is inside a string literal or past a `;` on this line.
 * One line only, like everything else here: a string that opened on an earlier
 * line costs a pointless request, not a wrong answer.
 */
function inStringOrComment(linePrefix: string): boolean {
    let inString = false;
    for (let i = 0; i < linePrefix.length; i++) {
        const char = linePrefix[i];
        if (inString) {
            if (char === '\\') {
                i++; // an escaped `"` does not close the string
            } else if (char === '"') {
                inString = false;
            }
        } else if (char === '"') {
            inString = true;
        } else if (char === ';') {
            return true;
        }
    }
    return inString;
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
}
