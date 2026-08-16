import * as assert from 'node:assert/strict';
import { findMigrationIssues, MIGRATIONS, migrationMessage } from '../phelMigration';

/** The names reported for `src`, in source order. */
function names(src: string): string[] {
    return findMigrationIssues(src).map((i) => i.name);
}

describe('findMigrationIssues', () => {
    it('flags a call to a core function 0.50 removed', () => {
        const issues = findMigrationIssues('(push xs 1)');
        assert.equal(issues.length, 1);
        assert.equal(issues[0].name, 'push');
        assert.equal(issues[0].status, 'removed');
        assert.equal(issues[0].replacement, 'conj');
        assert.match(issues[0].message, /removed in Phel 0\.50/);
    });

    it('reports the range of the head symbol only', () => {
        const src = '(values m)';
        const [issue] = findMigrationIssues(src);
        assert.equal(src.slice(issue.start, issue.end), 'values');
    });

    it('flags the forms deprecated as source', () => {
        assert.deepEqual(names('(php/new \\DateTime)'), ['php/new']);
        assert.deepEqual(names('(php/-> o (format "Y"))'), ['php/->']);
        assert.deepEqual(names('(php/:: C (m 1))'), ['php/::']);
        assert.deepEqual(names('(set-var v 1)'), ['set-var']);
    });

    it('offers no rename where the replacement rearranges the call', () => {
        // `(php/-> o (format "Y"))` becomes `(.format o "Y")`: the method name
        // moves out of a nested list, so a head swap would be wrong.
        for (const src of ['(php/-> o (format "Y"))', '(php/:: C (m 1))', '(set-var v 1)']) {
            assert.equal(findMigrationIssues(src)[0].replacement, undefined, src);
        }
    });

    it('ignores a removed name outside call position', () => {
        // These are the names most likely to appear as data or as an argument.
        assert.deepEqual(names('(def m {:values 1 :id 2})'), []);
        assert.deepEqual(names('(map inc values)'), []);
        assert.deepEqual(names('[push put unset]'), []);
    });

    it('ignores a name a local binding shadows', () => {
        assert.deepEqual(names('(defn f [values] (values))'), []);
        assert.deepEqual(names('(let [push (fn [x] x)] (push 1))'), []);
        assert.deepEqual(names('(fn [id] (id 3))'), []);
    });

    it('flags again once the shadowing binding is out of scope', () => {
        const src = '(defn f [values] (values))\n(defn g [m] (values m))';
        assert.deepEqual(names(src), ['values']);
    });

    it('ignores a name the file defines itself', () => {
        assert.deepEqual(names('(defn id [x] x)\n(defn use-it [] (id 3))'), []);
        assert.deepEqual(names('(defmacro push [x] x)\n(push 1)'), []);
    });

    it('ignores a quoted form, which is data rather than a call', () => {
        assert.deepEqual(names("(def sample '(push 1 2))"), []);
        assert.deepEqual(names("(def nested '((put m :a 1)))"), []);
    });

    it('flags inside a syntax-quote, which expands to a real call site', () => {
        assert.deepEqual(names('(defmacro m2 [x] `(push ~x 1))'), ['push']);
    });

    it('ignores an occurrence inside a string or a comment', () => {
        assert.deepEqual(names('(def s "(push xs 1)")'), []);
        assert.deepEqual(names('; (push xs 1)\n(def a 1)'), []);
    });

    it('returns issues in source order', () => {
        assert.deepEqual(names('(do (values m) (push xs 1) (put m :a 1))'), [
            'values',
            'push',
            'put',
        ]);
    });

    it('has no repeated names in the table', () => {
        const seen = new Set(MIGRATIONS.map((e) => e.name));
        assert.equal(seen.size, MIGRATIONS.length);
    });

    it('phrases removed and deprecated entries differently', () => {
        const removed = MIGRATIONS.find((e) => e.name === 'push');
        const deprecated = MIGRATIONS.find((e) => e.name === 'php/->');
        assert.ok(removed && deprecated);
        assert.match(migrationMessage(removed), /was removed in Phel 0\.50/);
        assert.match(migrationMessage(deprecated), /deprecated as source since Phel 0\.50/);
    });

    it('survives unbalanced source without throwing', () => {
        assert.doesNotThrow(() => findMigrationIssues('(push xs'));
        assert.doesNotThrow(() => findMigrationIssues('(defn f [x'));
        assert.doesNotThrow(() => findMigrationIssues('"unterminated'));
    });
});
