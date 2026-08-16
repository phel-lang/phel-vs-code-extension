// Guards the symbol surfaces completion is built from.
//
// `phel.core` bootstraps itself with bare `(def name {…} (fn …))` forms, and
// the corpus records `kind` / `private` from the defining operator, so it
// cannot tell a macro (`defn`), an early function (`first`) and an internal
// helper (`concat1`) apart. `CORE_DEF_FORMS` in `phelCoreSymbols.ts` carries
// that classification by hand; this pins it against the corpus it describes.

import * as assert from 'node:assert/strict';

import { CORE_FNS, CORE_VALUES, MACROS, SPECIAL_FORMS } from '../phelCoreSymbols';
import { PHEL_DOCS } from '../phelCoreDocs';

/**
 * The `phel.core` `def`s phel marks `{:private true}` or `^:private`. The
 * corpus reads `private` off the operator, so it records every one of them as
 * public; none may be offered. Listed here rather than in the shipped module
 * because only this guard has any use for them.
 */
const INTERNAL_CORE_DEFS = [
    '*hierarchy*',
    '*protocol-type-relations*',
    '*type-tag-registry*',
    'concat1',
    'copy-meta',
    'defn-builder',
    'first-map-entry',
    'first-of-set',
    'first-of-string',
    'munge-instance',
    'next-of-map',
    'next-of-set',
    'next-vector-or-nil',
    'special-symbols',
    'symbol-munge',
];

const offered = new Set([...SPECIAL_FORMS, ...MACROS, ...CORE_FNS, ...CORE_VALUES]);

describe('phel core symbols', () => {
    it('offers the def forms core installs as macros', () => {
        // `(def defn {:macro true} (fn …))`, and the same for the other three.
        for (const name of ['declare', 'defmacro', 'defn', 'meta']) {
            assert.ok(MACROS.includes(name), `${name} is not offered as a macro`);
        }
    });

    it('offers the private-defining forms the corpus does record', () => {
        // `defn-` / `defmacro-` are written with `defmacro` once it exists, so
        // they arrive as macros; `def-` is in the hand-curated special forms.
        assert.ok(MACROS.includes('defn-'), 'defn- is not offered');
        assert.ok(MACROS.includes('defmacro-'), 'defmacro- is not offered');
        assert.ok(SPECIAL_FORMS.includes('def-'), 'def- is not offered');
    });

    it('offers the functions core defines before `defn` exists', () => {
        for (const name of ['first', 'next', 'with-meta', 'vary-meta', 'queue', 'array-map']) {
            assert.ok(CORE_FNS.includes(name), `${name} is not offered as a core function`);
        }
    });

    it('offers the core dynamic vars and constants as values', () => {
        assert.deepEqual(
            [...CORE_VALUES],
            ['*argv*', '*assert*', '*file*', '*ns*', '*program*', 'NAN']
        );
    });

    it('keeps phel-internal core defs out of every list', () => {
        const leaked = INTERNAL_CORE_DEFS.filter((name) => offered.has(name));
        assert.deepEqual(leaked, [], `internal core defs offered in completion: ${leaked}`);
    });

    it('classifies every public core def in the corpus', () => {
        // A corpus regen that adds a bootstrap `def` lands here rather than
        // silently going missing from completion.
        const unclassified = PHEL_DOCS.filter(
            (d) =>
                d.kind === 'def' &&
                !d.private &&
                d.ns === 'phel.core' &&
                !offered.has(d.name) &&
                !INTERNAL_CORE_DEFS.includes(d.name)
        ).map((d) => d.name);
        assert.deepEqual(
            unclassified,
            [],
            `unclassified phel.core defs — add them to CORE_DEF_FORMS or to INTERNAL_CORE_DEFS: ${unclassified}`
        );
    });
});
