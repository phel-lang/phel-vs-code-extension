// Guards the symbol surfaces completion is built from.
//
// `phel.core` bootstraps itself with bare `(def name {…} (fn …))` forms, and
// what tells them apart lives in that meta-map: `{:macro true}` makes `defn` a
// macro, `{:private true}` makes `concat1` an internal helper. The parser
// reads both, so the corpus classifies them; what it cannot know is that a
// `def` without either marker (`first`) holds a function rather than a
// constant, and `CORE_DEF_FORMS` in `phelCoreSymbols.ts` carries that by hand.
// This pins both halves against the corpus they describe.

import * as assert from 'node:assert/strict';

import { CORE_FNS, CORE_VALUES, MACROS, SPECIAL_FORMS } from '../phelCoreSymbols';
import { PHEL_DOCS } from '../phelCoreDocs';

const offered = new Set([...SPECIAL_FORMS, ...MACROS, ...CORE_FNS, ...CORE_VALUES]);

function coreDoc(name: string) {
    return PHEL_DOCS.find((d) => d.qualifiedName === `phel.core/${name}`);
}

describe('phel core symbols', () => {
    it('records the def forms core installs as macros as macros', () => {
        // `(def defn {:macro true} (fn …))`, and the same for the other three.
        for (const name of ['declare', 'defmacro', 'defn', 'meta']) {
            assert.equal(coreDoc(name)?.kind, 'macro', `${name} is not a macro in the corpus`);
            assert.ok(MACROS.includes(name), `${name} is not offered as a macro`);
        }
    });

    it('offers the private-defining forms', () => {
        // `defn-` / `defmacro-` are written with `defmacro` once it exists;
        // `def-` is a `{:macro true}` def, and predates both.
        assert.ok(MACROS.includes('defn-'), 'defn- is not offered');
        assert.ok(MACROS.includes('defmacro-'), 'defmacro- is not offered');
        assert.ok(MACROS.includes('def-'), 'def- is not offered as a macro');
        assert.ok(SPECIAL_FORMS.includes('def-'), 'def- is not offered as a special form');
    });

    it('offers the functions core defines before `defn` exists', () => {
        for (const name of ['first', 'next', 'with-meta', 'vary-meta', 'queue', 'array-map']) {
            assert.equal(coreDoc(name)?.kind, 'def', `${name} is not a bare def in the corpus`);
            assert.ok(CORE_FNS.includes(name), `${name} is not offered as a core function`);
        }
    });

    it('offers the core dynamic vars and constants as values', () => {
        assert.deepEqual(
            [...CORE_VALUES],
            ['*argv*', '*assert*', '*file*', '*ns*', '*program*', 'NAN']
        );
    });

    it('keeps the core names phel marks private out of every list', () => {
        // `(def ^:private symbol-munge …)` and `(def concat1 {:private true} …)`
        // are internals; nothing in the extension may suggest them.
        // A name is only leaked when nothing public anywhere in the corpus
        // shares it: `sequential?` and `mean` are private in one namespace and
        // exported from another, and the lists are flat name arrays.
        const publicNames = new Set(PHEL_DOCS.filter((d) => !d.private).map((d) => d.name));
        const leaked = PHEL_DOCS.filter(
            (d) =>
                d.private && d.ns === 'phel.core' && !publicNames.has(d.name) && offered.has(d.name)
        ).map((d) => d.name);
        assert.deepEqual(leaked, [], `private core defs offered in completion: ${leaked}`);
    });

    it('classifies every public core def in the corpus', () => {
        // A corpus regen that adds a bootstrap `def` lands here rather than
        // silently going missing from completion.
        const unclassified = PHEL_DOCS.filter(
            (d) => d.kind === 'def' && !d.private && d.ns === 'phel.core' && !offered.has(d.name)
        ).map((d) => d.name);
        assert.deepEqual(
            unclassified,
            [],
            `unclassified phel.core defs — add them to CORE_DEF_FORMS: ${unclassified}`
        );
    });
});
