// Public symbol surfaces consumed by the completion provider.
//
// `SPECIAL_FORMS` is a hand-curated snapshot of the compiler-engine special
// forms (the `NAME_*` constants in phel-lang's `src/php/Lang/Symbol.php`).
// They live in PHP, not in any `.phel` source, so they can't be derived from
// `PHEL_DOCS`.
//
// `MACROS`, `CORE_FNS` and `CORE_VALUES` are projections of `PHEL_DOCS`, with
// the bare-`def` forms of `CORE_DEF_FORMS` folded in. Regenerate the
// underlying database via `node scripts/regen-core-docs.cjs /path/to/phel-lang`
// (see CONTRIBUTING.md) and these arrays follow automatically.

import { PHEL_DOCS } from './phelCoreDocs';
import type { PhelDoc } from './phelDocs';

export const SPECIAL_FORMS: readonly string[] = [
    'apply',
    'break',
    'catch',
    'concat',
    'conj',
    'def',
    'def-',
    'defonce',
    'defenum*',
    'defexception*',
    'definterface*',
    'defstruct*',
    'deref',
    'do',
    'finally',
    'fn',
    'foreach',
    'hash-map',
    'if',
    'in-ns',
    'let',
    'list',
    'load',
    'loop',
    'new',
    'ns',
    'php/->',
    'php/::',
    'php/callable',
    'php/aget',
    'php/aget-in',
    'php/apush',
    'php/apush-in',
    'php/aset',
    'php/aset-in',
    'php/aunset',
    'php/aunset-in',
    'php/new',
    'php/oset',
    'php/ref',
    'quote',
    'recur',
    'reify*',
    'set-var',
    'throw',
    'try',
    'unquote',
    'unquote-splicing',
    'use',
    'var',
    'vector',
];

/**
 * PHP superglobals, reachable from Phel as `php/$_SERVER` and friends.
 *
 * Like the special forms these exist only in PHP, so no `.phel` file declares
 * them and the corpus cannot carry them. Mirrors
 * `PhpSymbolCatalog::SUPERGLOBALS` in phel-lang, which is what the language
 * server and the REPL completer offer (#3037).
 */
export const PHP_SUPERGLOBALS: ReadonlyMap<string, string> = new Map([
    ['php/$GLOBALS', 'References all variables available in global scope.'],
    ['php/$_SERVER', 'Server and execution environment information.'],
    ['php/$_GET', 'HTTP GET variables.'],
    ['php/$_POST', 'HTTP POST variables.'],
    ['php/$_FILES', 'HTTP file upload variables.'],
    ['php/$_COOKIE', 'HTTP cookies.'],
    ['php/$_SESSION', 'Session variables.'],
    ['php/$_REQUEST', 'HTTP request variables.'],
    ['php/$_ENV', 'Environment variables.'],
]);

function uniqueSorted(values: Iterable<string>): string[] {
    const set = new Set<string>(values);
    return [...set].sort();
}

function namesWhere(predicate: (doc: PhelDoc) => boolean): string[] {
    return uniqueSorted(PHEL_DOCS.filter(predicate).map((d) => d.name));
}

/**
 * How to offer the `phel.core` names a bare `(def …)` introduces.
 *
 * Core bootstraps itself: `defn` and `defmacro` are installed as
 * `(def defn {:macro true} (fn …))` — they are what every later `defn` is
 * written with — and the earliest functions (`first`, `next`, `with-meta`) are
 * defined the same way, before `defn` exists. The corpus takes `kind` and
 * `private` from the defining operator, so all of them are recorded as public
 * `def`s, and the `{:macro true}` / `{:private true}` / `^:private` markers
 * that tell them apart are not carried. This table restores that split; it is
 * hand-kept for the same reason `SPECIAL_FORMS` is — the fact lives in the
 * phel source, not in the corpus.
 *
 * Only the names worth offering are listed: the fifteen core `def`s phel marks
 * private stay out, and so do `def-`, `concat`, `hash-map`, `list` and
 * `vector`, which `SPECIAL_FORMS` already offers because the compiler
 * special-cases them. Entries are still filtered through the corpus, so a name
 * upstream drops disappears from completion with it.
 *
 * Source: `src/phel/core.phel`, `src/phel/core/defs.phel`,
 * `src/phel/core/meta.phel` and `src/phel/core/math.phel` in phel-lang.
 */
const CORE_DEF_FORMS: ReadonlyMap<string, 'macro' | 'fn' | 'value'> = new Map([
    ['declare', 'macro'],
    ['defmacro', 'macro'],
    ['defn', 'macro'],
    ['meta', 'macro'],
    ['array-map', 'fn'],
    ['first', 'fn'],
    ['next', 'fn'],
    ['queue', 'fn'],
    ['to-php-array', 'fn'],
    ['vary-meta', 'fn'],
    ['with-meta', 'fn'],
    ['*argv*', 'value'],
    ['*assert*', 'value'],
    ['*file*', 'value'],
    ['*ns*', 'value'],
    ['*program*', 'value'],
    ['NAN', 'value'],
]);

function coreDefNames(as: 'macro' | 'fn' | 'value'): string[] {
    return namesWhere(
        (d) =>
            d.kind === 'def' &&
            !d.private &&
            d.ns === 'phel.core' &&
            CORE_DEF_FORMS.get(d.name) === as
    );
}

/** Public macros across every shipped `phel.*` namespace. */
export const MACROS: readonly string[] = uniqueSorted([
    ...namesWhere((d) => d.kind === 'macro' && !d.private),
    ...coreDefNames('macro'),
]);

/** Public functions defined inside the auto-imported `phel.core` namespace. */
export const CORE_FNS: readonly string[] = uniqueSorted([
    ...namesWhere((d) => d.kind === 'fn' && !d.private && d.ns === 'phel.core'),
    ...coreDefNames('fn'),
]);

/** Public `phel.core` values: the dynamic vars and the numeric constants. */
export const CORE_VALUES: readonly string[] = coreDefNames('value');
