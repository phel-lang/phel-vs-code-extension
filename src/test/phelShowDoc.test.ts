import * as assert from 'assert';
import type { PhelDoc } from '../phelDocs';
import { buildQuickPickEntries } from '../phelShowDoc';

const corpus: PhelDoc[] = [
    {
        name: 'b-public',
        ns: 'phel.misc',
        qualifiedName: 'phel.misc/b-public',
        kind: 'fn',
        private: false,
        signature: '(b-public x)',
        doc: 'A public misc helper.\nMore detail on next line.',
    },
    {
        name: 'a-public',
        ns: 'phel.misc',
        qualifiedName: 'phel.misc/a-public',
        kind: 'macro',
        private: false,
        signature: '(a-public form)',
    },
    {
        name: 'private-thing',
        ns: 'phel.misc',
        qualifiedName: 'phel.misc/private-thing',
        kind: 'fn',
        private: true,
        signature: '(private-thing)',
    },
    {
        name: 'assoc',
        ns: 'phel.core',
        qualifiedName: 'phel.core/assoc',
        kind: 'fn',
        private: false,
        signature: '(assoc m k v)',
        doc: 'Associates.',
    },
    {
        name: 'map',
        ns: 'phel.core',
        qualifiedName: 'phel.core/map',
        kind: 'fn',
        private: false,
        signature: '(map f & xs)',
    },
];

describe('buildQuickPickEntries', function () {
    it('excludes private symbols by default', function () {
        const entries = buildQuickPickEntries(corpus);
        assert.ok(!entries.some((e) => e.doc.private), 'no private entries should leak through');
    });

    it('includes private symbols when explicitly requested', function () {
        const entries = buildQuickPickEntries(corpus, { includePrivate: true });
        assert.ok(entries.some((e) => e.doc.qualifiedName === 'phel.misc/private-thing'));
    });

    it('sorts phel.core symbols ahead of every other namespace', function () {
        const entries = buildQuickPickEntries(corpus);
        const namespaces = entries.map((e) => e.doc.ns);
        const firstNonCore = namespaces.findIndex((n) => n !== 'phel.core');
        const lastCore = namespaces.lastIndexOf('phel.core');
        assert.ok(lastCore < firstNonCore, 'all phel.core entries should come first');
    });

    it('sorts alphabetically within a namespace', function () {
        const entries = buildQuickPickEntries(corpus);
        const miscNames = entries.filter((e) => e.doc.ns === 'phel.misc').map((e) => e.doc.name);
        assert.deepStrictEqual(miscNames, [...miscNames].sort());
    });

    it('puts the namespace and signature in the description', function () {
        const entries = buildQuickPickEntries(corpus);
        const map = entries.find((e) => e.doc.qualifiedName === 'phel.core/map');
        assert.ok(map);
        assert.strictEqual(map!.description, 'phel.core · (map f & xs)');
    });

    it('uses the first docstring line as the detail', function () {
        const entries = buildQuickPickEntries(corpus);
        const bPublic = entries.find((e) => e.doc.qualifiedName === 'phel.misc/b-public');
        assert.ok(bPublic);
        assert.strictEqual(bPublic!.detail, 'A public misc helper.');
    });

    it('falls back to the kind label when no docstring is available', function () {
        const entries = buildQuickPickEntries(corpus);
        const aPublic = entries.find((e) => e.doc.qualifiedName === 'phel.misc/a-public');
        assert.ok(aPublic);
        assert.strictEqual(aPublic!.detail, 'macro');
    });

    it('preserves the underlying doc on each entry', function () {
        const entries = buildQuickPickEntries(corpus);
        for (const e of entries) {
            assert.strictEqual(typeof e.doc.qualifiedName, 'string');
        }
    });
});
