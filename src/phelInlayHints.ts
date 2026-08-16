// Parameter-name inlay hints: `(assoc m :k v)` renders as
// `(assoc ds: m key: :k value: v)`.
//
// The whole value of the feature is that a label is *right*; a wrong one is
// worse than none, because the reader trusts it. So every rule here errs
// towards emitting nothing:
//
//   * only heads the caller's `resolve` accepts. The provider hands over the
//     arities of `kind: 'fn'` docs only — a macro or special form does not
//     evaluate its arguments positionally (`(let [x 1] …)`, `(if a b c)`), so
//     its parameter names would describe a shape, not a value;
//   * nothing under a quote or syntax-quote, where a list is data, not a call;
//   * nothing whose head resolves to a local binding — `(let [map (fn [x] x)]
//     (map 1))` calls the local, not `phel.core/map`, and most short parameter
//     names collide with a core function;
//   * nothing past the fixed parameters. A `& rest` label repeats itself on
//     every remaining argument and says nothing the name did not, so the run
//     stops at the first variadic parameter;
//   * nothing when the argument is already spelled like the parameter
//     (`(assoc ds key value)` over `ds`, `key`, `value`).
//
// Threading macros move the arguments around, so the mapping has to follow:
// inside `->` / `some->` / `doto` / `cond->` the first parameter is the
// threaded value and the written arguments start one index later, and a
// `->>` / `some->>` / `cond->>` subtree is skipped whole because the threaded
// value lands last, where a variadic tail makes the mapping guesswork.
//
// Free of `vscode` imports, so the unit tests and `npm run sweep` exercise the
// same code the editor runs.

import { derive, parseAllCached } from './phelParseCache';
import type { Form } from './phelParedit';
import { collectAllBindings, resolveLocalAt } from './phelScope';
import { hasRest, parseSignatureParams } from './phelSignatureHelp';

export interface ParameterHint {
    /** Offset of the first character of the argument the label sits before. */
    offset: number;
    /** The parameter name with a trailing colon, e.g. `key:`. */
    label: string;
    /** The arity the label was read off, for the hint tooltip. */
    signature: string;
}

/**
 * Arities (`['(assoc ds key value)', …]`) for a head symbol as written in the
 * source, or undefined when the symbol is not a function whose parameters can
 * be named. Deciding *what counts as a function* is the caller's job.
 *
 * Called at most once per distinct name per `parameterHints` call, so a
 * resolver may be as expensive as a corpus scan.
 */
export type ArityResolver = (name: string) => readonly string[] | undefined;

/** Threaded into the first argument slot: the steps start at parameter 1. */
const THREAD_FIRST = new Set(['->', 'some->', 'doto']);
/** Same, but the steps are `test step` pairs rather than plain forms. */
const THREAD_FIRST_PAIRS = 'cond->';
/** Threaded into the last argument slot; every step inside is skipped. */
const THREAD_LAST = new Set(['->>', 'some->>', 'cond->>']);

/** Everything the walk needs besides the form it is on. */
interface Walk {
    src: string;
    range: { start: number; end: number };
    resolve: ArityResolver;
    /** Names some binding form declares *somewhere* in the file. */
    shadowable: ReadonlySet<string>;
    out: ParameterHint[];
}

/**
 * Parameter-name labels for the call forms of `src` that intersect `range`, in
 * document order. Offsets are absolute in `src`; the caller turns them into
 * editor positions.
 */
export function parameterHints(
    src: string,
    range: { start: number; end: number },
    resolve: ArityResolver
): ParameterHint[] {
    const walk: Walk = {
        src,
        range,
        resolve: memoise(resolve),
        shadowable: shadowableNames(src),
        out: [],
    };
    for (const form of parseAllCached(src)) {
        visit(walk, form, false, 0);
    }
    // A form is labelled before its children are walked, so the raw order is
    // by nesting depth, not by position.
    return walk.out.sort((a, b) => a.offset - b.offset);
}

/**
 * Walk `form`, collecting hints. `quoted` is inherited from the enclosing
 * forms; `shift` is the parameter index the first written argument of *this*
 * form maps to (1 under a thread-first macro, 0 otherwise).
 */
function visit(walk: Walk, form: Form, quoted: boolean, shift: number): void {
    // Clipping a subtree that cannot contribute is what keeps a big file cheap:
    // the editor asks for the visible range, and the rest of the tree is never
    // descended into.
    if (form.end < walk.range.start || form.start > walk.range.end) {
        return;
    }

    const nowQuoted = quoteStateOf(walk.src, form, quoted);
    const head = callHead(walk.src, form);

    if (head !== undefined && THREAD_LAST.has(head)) {
        return;
    }

    if (head !== undefined && !nowQuoted) {
        collect(walk, form, head, shift);
    }

    for (let i = 0; i < form.children.length; i++) {
        visit(walk, form.children[i], nowQuoted, stepShift(head, i));
    }
}

/**
 * One `resolve` call per distinct head name. A resolver over the symbol corpus
 * scans a few thousand records, and a viewport of real code calls the same
 * dozen names over and over (`str`, `get`, `assoc`, …).
 */
function memoise(resolve: ArityResolver): ArityResolver {
    const seen = new Map<string, readonly string[] | undefined>();
    return (name) => {
        if (seen.has(name)) {
            return seen.get(name);
        }
        const arities = resolve(name);
        seen.set(name, arities);
        return arities;
    };
}

/**
 * Every name bound by a `let` / `fn` / `for` / … anywhere in `src`, memoised
 * against the source like the parse tree it is derived from.
 *
 * `resolveLocalAt` is the only expensive call on the path — it re-derives the
 * bindings of every enclosing form — and it can only return a binding whose
 * name is in this set. One pass up front therefore buys skipping it for the
 * overwhelming majority of heads, which are core functions nobody rebinds.
 */
function shadowableNames(src: string): ReadonlySet<string> {
    return derive(
        src,
        'inlayHints.shadowable',
        () => new Set(collectAllBindings(src).map((b) => b.name))
    );
}

/**
 * The head symbol of a call form (`(f …)` and the `#(f …)` short function),
 * or undefined when the form is not a call or its head is not a plain symbol.
 */
function callHead(src: string, form: Form): string | undefined {
    if (form.kind !== 'list' && form.kind !== 'anon') {
        return undefined;
    }
    const head = form.children[0];
    if (!head || head.kind !== 'atom' || head.start !== head.bodyStart) {
        return undefined;
    }
    const text = src.slice(head.bodyStart, head.bodyEnd);
    return text.length > 0 ? text : undefined;
}

/** Parameter index the first written argument of child `i` maps to. */
function stepShift(head: string | undefined, i: number): number {
    if (head === undefined) {
        return 0;
    }
    // `(-> x (f a) (g b))`: children 2 and up are steps.
    if (THREAD_FIRST.has(head)) {
        return i >= 2 ? 1 : 0;
    }
    // `(cond-> x test (f a) test (g b))`: only the odd children are steps.
    if (head === THREAD_FIRST_PAIRS) {
        return i >= 3 && i % 2 === 1 ? 1 : 0;
    }
    return 0;
}

function collect(walk: Walk, form: Form, head: string, shift: number): void {
    const arities = walk.resolve(head);
    if (!arities || arities.length === 0) {
        return;
    }
    // Only after `resolve` said yes, and only for a name the file binds
    // somewhere: both checks are lookups, the scope walk behind them is not.
    if (walk.shadowable.has(head) && resolveLocalAt(walk.src, form.children[0].bodyStart)) {
        return;
    }

    const args = form.children.slice(1);
    const signature = pickArity(arities, args.length + shift);
    if (signature === undefined) {
        return;
    }
    const params = parseSignatureParams(signature);

    for (let i = 0; i < args.length; i++) {
        const param = params[i + shift];
        if (param === undefined || param.startsWith('&')) {
            return;
        }
        const arg = args[i];
        if (arg.start < walk.range.start || arg.start > walk.range.end) {
            continue;
        }
        if (arg.kind === 'atom' && walk.src.slice(arg.bodyStart, arg.bodyEnd) === param) {
            continue;
        }
        walk.out.push({ offset: arg.start, label: `${param}:`, signature });
    }
}

/**
 * The arity `argCount` arguments were written against: an exact fixed match
 * first, else the widest variadic arity whose fixed parameters are all
 * supplied. Undefined when the call matches no arity at all — a wrong count is
 * a bug in the source, and labels from a guessed arity would mislabel it.
 */
function pickArity(arities: readonly string[], argCount: number): string | undefined {
    let variadic: string | undefined;
    let variadicFixed = -1;
    for (const arity of arities) {
        const params = parseSignatureParams(arity);
        if (!labelable(params)) {
            continue;
        }
        if (!hasRest(params)) {
            if (params.length === argCount) {
                return arity;
            }
            continue;
        }
        const fixed = params.length - 1;
        if (fixed <= argCount && fixed > variadicFixed) {
            variadic = arity;
            variadicFixed = fixed;
        }
    }
    return variadic;
}

/** A parameter name that is a plain symbol, not a piece of a destructuring form. */
const PLAIN_PARAM = /^[^\s()[\]{}"'`~@;,]+$/;

/**
 * Whether every fixed parameter is a plain symbol. Signatures are split on
 * whitespace, so a destructured parameter — `(assoc-in ds [k & ks] v)`, and
 * every `defn` over a `{:keys […]}` map — arrives as several tokens: both the
 * names and every index after them would be wrong, so the arity is dropped
 * whole. Destructuring *after* `&` (`(complete prompt & [opts])`, the common
 * option-map idiom) is unaffected, since labelling stops there anyway.
 */
function labelable(params: readonly string[]): boolean {
    for (const param of params) {
        if (param.startsWith('&')) {
            return true;
        }
        if (!PLAIN_PARAM.test(param)) {
            return false;
        }
    }
    return true;
}

/**
 * Whether `form` sits inside quoted data. Reader prefixes stack, so the last
 * one that matters wins: `'x` and `` `x `` quote, `~x` / `~@x` unquote back
 * into code.
 */
function quoteStateOf(src: string, form: Form, inherited: boolean): boolean {
    let quoted = inherited;
    for (let i = form.start; i < form.bodyStart; i++) {
        const c = src[i];
        if (c === "'" || c === '`') {
            quoted = true;
        } else if (c === '~') {
            quoted = false;
        }
    }
    return quoted;
}
