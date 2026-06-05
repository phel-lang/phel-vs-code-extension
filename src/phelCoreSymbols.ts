// Public symbol surfaces consumed by the completion provider.
//
// `SPECIAL_FORMS` is a hand-curated snapshot of the compiler-engine special
// forms (the `NAME_*` constants in phel-lang's `src/php/Lang/Symbol.php`).
// They live in PHP, not in any `.phel` source, so they can't be derived from
// `PHEL_DOCS`.
//
// `MACROS` and `CORE_FNS` are projections of `PHEL_DOCS`. Regenerate the
// underlying database via `node scripts/regen-core-docs.cjs /path/to/phel-lang`
// (see CONTRIBUTING.md) and these arrays follow automatically.

import { PHEL_DOCS } from './phelCoreDocs';
import type { PhelDoc } from './phelDocs';

export const SPECIAL_FORMS: readonly string[] = [
    'apply',
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

function uniqueSorted(values: Iterable<string>): string[] {
    const set = new Set<string>(values);
    return [...set].sort();
}

function namesWhere(predicate: (doc: PhelDoc) => boolean): string[] {
    return uniqueSorted(PHEL_DOCS.filter(predicate).map((d) => d.name));
}

/** Public macros across every shipped `phel.*` namespace. */
export const MACROS: readonly string[] = namesWhere((d) => d.kind === 'macro' && !d.private);

/** Public functions defined inside the auto-imported `phel.core` namespace. */
export const CORE_FNS: readonly string[] = namesWhere(
    (d) => d.kind === 'fn' && !d.private && d.ns === 'phel.core'
);
