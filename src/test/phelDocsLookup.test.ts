import * as assert from 'assert';
import type { PhelDoc } from '../phelDocs';
import { lookupSymbol, renderDocMarkdown } from '../phelDocsLookup';

const corpus: PhelDoc[] = [
    {
        name: 'assoc',
        ns: 'phel.core',
        qualifiedName: 'phel.core/assoc',
        kind: 'fn',
        private: false,
        signature: '(assoc m k v)',
        doc: 'Associates a key/value pair.',
        example: '(assoc {:a 1} :b 2) ; => {:a 1 :b 2}',
        seeAlso: ['dissoc', 'update'],
        sourceUrl:
            'https://github.com/phel-lang/phel-lang/blob/v0.35.0/src/phel/core/sequences.phel',
    },
    {
        name: 'is',
        ns: 'phel.test',
        qualifiedName: 'phel.test/is',
        kind: 'macro',
        private: false,
        signature: '(is form)',
        doc: 'Asserts that form evaluates truthy.',
    },
    {
        name: 'assoc',
        ns: 'phel.legacy',
        qualifiedName: 'phel.legacy/assoc',
        kind: 'fn',
        private: false,
        signature: '(assoc x)',
    },
    {
        name: 'helper',
        ns: 'phel.core',
        qualifiedName: 'phel.core/helper',
        kind: 'fn',
        private: true,
        signature: '(helper x)',
    },
    {
        name: 'orphan',
        ns: 'phel.misc',
        qualifiedName: 'phel.misc/orphan',
        kind: 'def',
        private: true,
    },
];

describe('lookupSymbol', function () {
    it('matches an exact qualified name first', function () {
        const r = lookupSymbol('phel.legacy/assoc', corpus);
        assert.ok(r);
        assert.strictEqual(r!.qualifiedName, 'phel.legacy/assoc');
    });

    it('prefers phel.core for unqualified names', function () {
        const r = lookupSymbol('assoc', corpus);
        assert.ok(r);
        assert.strictEqual(r!.ns, 'phel.core');
    });

    it('falls back to any public namespace when phel.core is absent', function () {
        const r = lookupSymbol('is', corpus);
        assert.ok(r);
        assert.strictEqual(r!.ns, 'phel.test');
    });

    it('falls back to a private definition as a last resort', function () {
        const r = lookupSymbol('orphan', corpus);
        assert.ok(r);
        assert.strictEqual(r!.qualifiedName, 'phel.misc/orphan');
    });

    it('returns undefined when nothing matches', function () {
        const r = lookupSymbol('nonexistent', corpus);
        assert.strictEqual(r, undefined);
    });

    it('returns undefined for an empty input', function () {
        assert.strictEqual(lookupSymbol('', corpus), undefined);
    });
});

describe('renderDocMarkdown', function () {
    it('includes signature, doc, example, see-also, and source link for a fn', function () {
        const md = renderDocMarkdown(corpus[0]);
        assert.match(md, /\*\*`phel\.core\/assoc`\*\* _function_/);
        assert.match(md, /```phel\n\(assoc m k v\)\n```/);
        assert.match(md, /Associates a key\/value pair\./);
        assert.match(md, /\*\*Example\*\*/);
        assert.match(md, /\(assoc \{:a 1\} :b 2\)/);
        assert.match(md, /\*\*See also:\*\* `dissoc`, `update`/);
        assert.match(
            md,
            /\[View source\]\(https:\/\/github\.com\/phel-lang\/phel-lang\/blob\/v0\.35\.0\/src\/phel\/core\/sequences\.phel\)/
        );
    });

    it('labels macros and private symbols correctly', function () {
        assert.match(renderDocMarkdown(corpus[1]), /_macro_/);
        assert.match(renderDocMarkdown(corpus[3]), /_private function_/);
    });

    it('renders def without a signature block', function () {
        const md = renderDocMarkdown(corpus[4]);
        assert.match(md, /_private def_/);
        assert.ok(!md.includes('```phel\n'), 'def without signature should not emit a code fence');
    });

    it('emits all arities when more than one is present', function () {
        const doc: PhelDoc = {
            name: 'multi',
            ns: 'phel.core',
            qualifiedName: 'phel.core/multi',
            kind: 'fn',
            private: false,
            signature: '(multi)',
            arities: ['(multi)', '(multi a)', '(multi a b)'],
        };
        const md = renderDocMarkdown(doc);
        assert.match(md, /```phel\n\(multi\)\n\(multi a\)\n\(multi a b\)\n```/);
    });

    it('omits sections when fields are missing', function () {
        const doc: PhelDoc = {
            name: 'bare',
            ns: 'phel.core',
            qualifiedName: 'phel.core/bare',
            kind: 'fn',
            private: false,
        };
        const md = renderDocMarkdown(doc);
        assert.match(md, /\*\*`phel\.core\/bare`\*\* _function_/);
        assert.ok(!md.includes('Example'));
        assert.ok(!md.includes('See also'));
        assert.ok(!md.includes('View source'));
    });
});
