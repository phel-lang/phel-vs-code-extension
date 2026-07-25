import * as assert from 'node:assert/strict';
import {
    aliasPrefix,
    aliasQualifiedCandidates,
    completionContextAt,
    requirableNamespaces,
} from '../phelCompletionContext';
import type { PhelDoc } from '../phelDocs';

const DOCS: PhelDoc[] = [
    { name: 'blank?', ns: 'phel.string', qualifiedName: 'phel.string/blank?', kind: 'fn' },
    { name: 'join', ns: 'phel.string', qualifiedName: 'phel.string/join', kind: 'fn' },
    {
        name: 'hidden',
        ns: 'phel.string',
        qualifiedName: 'phel.string/hidden',
        kind: 'fn',
        private: true,
    },
    { name: 'is', ns: 'phel.test', qualifiedName: 'phel.test/is', kind: 'macro' },
    { name: 'map', ns: 'phel.core', qualifiedName: 'phel.core/map', kind: 'fn' },
] as PhelDoc[];

describe('phelCompletionContext.aliasPrefix', () => {
    it('reads the alias out of a qualified token being typed', () => {
        assert.equal(aliasPrefix('(str/bla'), 'str');
        assert.equal(aliasPrefix('  (foo (s/'), 's');
    });

    it('ignores bare tokens and php interop', () => {
        assert.equal(aliasPrefix('(blan'), null);
        assert.equal(aliasPrefix('(php/strlen'), null);
        assert.equal(aliasPrefix(''), null);
    });
});

describe('phelCompletionContext.completionContextAt', () => {
    const src = [
        '(ns my.app',
        '  (:require [phel.string :as str])',
        '  (:require phel.test :as t))',
        '',
        '(defn f [] (str/blank? ""))',
    ].join('\n');

    function ctxAt(marker: string, linePrefix: string) {
        return completionContextAt(src, src.indexOf(marker) + marker.length, linePrefix);
    }

    it('resolves an alias from a vector require', () => {
        assert.deepEqual(ctxAt('str/blank', '(defn f [] (str/blank'), {
            kind: 'alias-qualified',
            alias: 'str',
            ns: 'phel.string',
        });
    });

    it('resolves an alias from a flat require', () => {
        const flat = '(ns a (:require phel.test :as t))\n(t/is true)';
        assert.deepEqual(completionContextAt(flat, flat.lastIndexOf('t/is') + 2, '(t/i'), {
            kind: 'alias-qualified',
            alias: 't',
            ns: 'phel.test',
        });
    });

    it('reports a namespace position inside a require clause', () => {
        const inClause = '(ns a\n  (:require ))';
        const offset = inClause.indexOf('(:require ') + '(:require '.length;
        assert.deepEqual(completionContextAt(inClause, offset, '  (:require '), {
            kind: 'ns-namespace',
        });
    });

    it('reports an option position inside a require entry vector', () => {
        const inVector = '(ns a\n  (:require [phel.string ]))';
        const offset = inVector.indexOf('phel.string ') + 'phel.string '.length;
        assert.deepEqual(completionContextAt(inVector, offset, '  (:require [phel.string '), {
            kind: 'ns-entry-option',
        });
    });

    it('reports a clause position directly inside the ns form', () => {
        const bare = '(ns a\n  )';
        assert.deepEqual(completionContextAt(bare, bare.indexOf('\n  ') + 3, '  '), {
            kind: 'ns-clause',
        });
    });

    it('falls back to normal outside the ns form', () => {
        assert.deepEqual(ctxAt('(defn f', '(defn f'), { kind: 'normal' });
    });

    it('falls back to normal for an alias that is not required', () => {
        assert.deepEqual(completionContextAt(src, src.length, '(zzz/no'), { kind: 'normal' });
    });
});

describe('phelCompletionContext.aliasQualifiedCandidates', () => {
    it('labels every public symbol of the namespace with the alias', () => {
        const cands = aliasQualifiedCandidates('str', 'phel.string', DOCS);
        assert.deepEqual(
            cands.map((c) => c.label),
            ['str/blank?', 'str/join']
        );
        assert.equal(cands[0].detail, 'phel.string/blank?');
        assert.equal(cands[0].name, 'blank?');
    });

    it('skips private symbols and other namespaces', () => {
        const labels = aliasQualifiedCandidates('str', 'phel.string', DOCS).map((c) => c.label);
        assert.ok(!labels.includes('str/hidden'));
        assert.ok(!labels.includes('str/is'));
    });
});

describe('phelCompletionContext.requirableNamespaces', () => {
    it('lists known namespaces minus the file own and already-required ones', () => {
        const src = '(ns my.app (:require [phel.string :as str]))';
        assert.deepEqual(requirableNamespaces(src, DOCS, 'my.app', ['phel.string']), [
            'phel.core',
            'phel.test',
        ]);
    });

    it('keeps every namespace when nothing is required yet', () => {
        assert.deepEqual(requirableNamespaces('(ns my.app)', DOCS, 'my.app'), [
            'phel.core',
            'phel.string',
            'phel.test',
        ]);
    });
});
