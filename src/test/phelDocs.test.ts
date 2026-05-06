import * as assert from 'assert';
import { parsePhelFile, PhelDoc } from '../phelDocs';

function single(source: string, ns = 'phel.core'): PhelDoc {
    const docs = parsePhelFile(source, ns);
    assert.strictEqual(docs.length, 1, `expected exactly one doc, got ${docs.length}`);
    return docs[0];
}

describe('parsePhelFile', function () {
    describe('defn', function () {
        it('extracts a public single-arity function', function () {
            const d = single(`
(defn assoc
  "Adds a key/value pair."
  [m k v]
  (do-stuff m k v))
`);
            assert.strictEqual(d.name, 'assoc');
            assert.strictEqual(d.qualifiedName, 'phel.core/assoc');
            assert.strictEqual(d.kind, 'fn');
            assert.strictEqual(d.private, false);
            assert.strictEqual(d.signature, '(assoc m k v)');
            assert.strictEqual(d.doc, 'Adds a key/value pair.');
            assert.deepStrictEqual(d.arities, undefined);
        });

        it('extracts a private function with defn-', function () {
            const d = single(`(defn- helper [x] x)`);
            assert.strictEqual(d.name, 'helper');
            assert.strictEqual(d.private, true);
            assert.strictEqual(d.kind, 'fn');
            assert.strictEqual(d.signature, '(helper x)');
            assert.strictEqual(d.doc, undefined);
        });

        it('extracts :example and :see-also from the meta-map', function () {
            const d = single(`
(defn map
  "Transforms a collection."
  {:example "(map inc [1 2 3]) ; => [2 3 4]"
   :see-also ["filter" "reduce"]}
  [f & xs]
  ...)
`);
            assert.strictEqual(d.example, '(map inc [1 2 3]) ; => [2 3 4]');
            assert.deepStrictEqual(d.seeAlso, ['filter', 'reduce']);
            assert.strictEqual(d.signature, '(map f & xs)');
        });

        it('captures all arities for a multi-arity defn', function () {
            const d = single(`
(defn arity-demo
  "Multiple shapes."
  ([] :nullary)
  ([a] a)
  ([a b & rest] [a b rest]))
`);
            assert.strictEqual(d.signature, '(arity-demo)');
            assert.deepStrictEqual(d.arities, [
                '(arity-demo)',
                '(arity-demo a)',
                '(arity-demo a b & rest)',
            ]);
        });

        it('decodes escape sequences in the docstring', function () {
            const d = single(`(defn foo "line one\\nline two with \\"quote\\"" [x] x)`);
            assert.strictEqual(d.doc, 'line one\nline two with "quote"');
        });

        it('survives a missing docstring with present meta-map', function () {
            const d = single(`(defn quick {:example "(quick 1)"} [x] x)`);
            assert.strictEqual(d.doc, undefined);
            assert.strictEqual(d.example, '(quick 1)');
            assert.strictEqual(d.signature, '(quick x)');
        });
    });

    describe('defmacro', function () {
        it('classifies macros and keeps the signature', function () {
            const d = single(`
(defmacro when-positive
  "Run body when x > 0."
  [x & body]
  \`(when (pos? ~x) ~@body))
`);
            assert.strictEqual(d.kind, 'macro');
            assert.strictEqual(d.private, false);
            assert.strictEqual(d.signature, '(when-positive x & body)');
        });

        it('marks defmacro- as private', function () {
            const d = single(`(defmacro- internal-mac [x] x)`);
            assert.strictEqual(d.kind, 'macro');
            assert.strictEqual(d.private, true);
        });
    });

    describe('def', function () {
        it('captures bare defs without a signature', function () {
            const d = single(`(def *taps* (atom #{}))`);
            assert.strictEqual(d.name, '*taps*');
            assert.strictEqual(d.kind, 'def');
            assert.strictEqual(d.signature, undefined);
            assert.strictEqual(d.arities, undefined);
        });

        it('marks def- as private', function () {
            const d = single(`(def- mock-registry (atom {}))`);
            assert.strictEqual(d.kind, 'def');
            assert.strictEqual(d.private, true);
        });
    });

    describe('multi-form input', function () {
        it('returns one doc per top-level form, in order', function () {
            const docs = parsePhelFile(
                `
;; Header comment
(ns phel.core)

(defn first-fn [x] x)
(defn- second-fn "Second!" [a b] a)
(def constant 42)
(defmacro third [body] body)
`,
                'phel.core'
            );
            assert.deepStrictEqual(
                docs.map((d) => d.name),
                ['first-fn', 'second-fn', 'constant', 'third']
            );
            assert.strictEqual(docs[1].private, true);
            assert.strictEqual(docs[1].doc, 'Second!');
        });

        it('skips non-defining forms', function () {
            const docs = parsePhelFile(
                `(println "hi") (let [x 1] x) (defn keeper [x] x)`,
                'phel.x'
            );
            assert.strictEqual(docs.length, 1);
            assert.strictEqual(docs[0].name, 'keeper');
        });

        it('ignores forms inside #_ reader-comments', function () {
            const docs = parsePhelFile(
                `
#_(defn skipped [x] x)
(defn kept [y] y)
`,
                'phel.x'
            );
            assert.deepStrictEqual(
                docs.map((d) => d.name),
                ['kept']
            );
        });

        it('ignores forms inside line comments and block comments', function () {
            const docs = parsePhelFile(
                `
;; (defn nope [x] x)
#| block (defn also-nope [x] x) block |#
(defn yes [z] z)
`,
                'phel.x'
            );
            assert.deepStrictEqual(
                docs.map((d) => d.name),
                ['yes']
            );
        });
    });
});
