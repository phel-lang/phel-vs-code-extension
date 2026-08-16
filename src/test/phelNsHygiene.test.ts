import * as assert from 'node:assert/strict';
import {
    findUnusedRequires,
    removeRequireEdit,
    requireIssueIn,
    sortRequiresEdit,
    type NsEdit,
} from '../phelNsHygiene';

function apply(src: string, edit: NsEdit | null): string {
    assert.ok(edit, 'no edit');
    return src.slice(0, edit.start) + edit.text + src.slice(edit.end);
}

/** Remove what the nth finding reports, so a fixture reads as one statement. */
function removeIssue(src: string, index = 0): string {
    const issues = findUnusedRequires(src);
    assert.ok(issues[index], `no issue #${index} in:\n${src}`);
    return apply(src, removeRequireEdit(src, issues[index]));
}

describe('phelNsHygiene.findUnusedRequires', () => {
    it('says nothing about a file with no ns form or no requires', () => {
        assert.deepEqual(findUnusedRequires('(defn f [] 1)'), []);
        assert.deepEqual(findUnusedRequires('(ns my.app)'), []);
    });

    it('flags an entry whose :refer names are all unused', () => {
        const src = '(ns my.app\n  (:require [other.ns :refer [a b]]))\n\n(defn f [] 1)\n';
        const issues = findUnusedRequires(src);
        assert.equal(issues.length, 1);
        assert.equal(issues[0].kind, 'require');
        assert.equal(issues[0].ns, 'other.ns');
        assert.equal(src.slice(issues[0].start, issues[0].end), '[other.ns :refer [a b]]');
        assert.equal(issues[0].message, "'other.ns' is required but never used");
    });

    it('flags only the dead name when the entry is otherwise used', () => {
        const src = '(ns my.app\n  (:require [other.ns :refer [a b]]))\n\n(defn f [] (a 1))\n';
        const issues = findUnusedRequires(src);
        assert.equal(issues.length, 1);
        assert.equal(issues[0].kind, 'refer');
        assert.equal(issues[0].name, 'b');
        assert.equal(src.slice(issues[0].start, issues[0].end), 'b');
        assert.equal(issues[0].message, "'b' is referred from 'other.ns' but never used");
    });

    it('counts a use through the explicit :as alias', () => {
        const src = '(ns my.app\n  (:require [other.ns :as o]))\n\n(defn f [] (o/run))\n';
        assert.deepEqual(findUnusedRequires(src), []);
    });

    it('counts a use through the implicit alias, the last segment', () => {
        // `(:require phel.json)` binds `json`, exactly as `SymbolAlias` says.
        const used = '(ns my.app\n  (:require phel.json))\n\n(defn f [x] (json/encode x))\n';
        assert.deepEqual(findUnusedRequires(used), []);

        const unused = '(ns my.app\n  (:require phel.json))\n\n(defn f [x] x)\n';
        assert.equal(findUnusedRequires(unused).length, 1);
    });

    it('counts a use through the implicit alias of a backslash-spelled entry', () => {
        const src = '(ns my.app\n  (:require phel\\json))\n\n(defn f [x] (json/encode x))\n';
        assert.deepEqual(findUnusedRequires(src), []);
    });

    it('does not count the ns form itself as a use', () => {
        // Every name is written once inside `(ns …)`; only what is outside it
        // makes an entry live.
        const src = '(ns my.app\n  (:require [other.ns :refer [a]]))\n';
        assert.equal(findUnusedRequires(src).length, 1);
    });

    it('does not count a name that only occurs in a string or a comment', () => {
        const src = '(ns my.app\n  (:require [other.ns :refer [a]]))\n\n(def s "a") ; a\n';
        assert.equal(findUnusedRequires(src).length, 1);
    });

    it('counts a use inside a syntax-quoted macro template', () => {
        // Conservative on purpose: the expansion is what reaches the namespace,
        // and a template is the one place a require looks dead but is not.
        const src = '(ns my.app\n  (:require [other.ns :refer [a]]))\n\n(defmacro m [] `(a 1))\n';
        assert.deepEqual(findUnusedRequires(src), []);
    });

    it('sees every (:require …) clause, not only the first', () => {
        // One clause per namespace is what `phel init` scaffolds, so stopping
        // at the first would miss the require most likely to be stale.
        const src = `(ns demo.main-test
  (:require phel.test :refer [deftest is])
  (:require demo.main :refer [greet]))

(deftest test-nothing
  (is (= 1 1)))
`;
        const issues = findUnusedRequires(src);
        assert.deepEqual(
            issues.map((i) => i.ns),
            ['demo.main']
        );
        assert.equal(issues[0].kind, 'require');
        assert.equal(
            removeIssue(src),
            `(ns demo.main-test
  (:require phel.test :refer [deftest is]))

(deftest test-nothing
  (is (= 1 1)))
`
        );
    });

    it('reads a flat entry the way the compiler does', () => {
        const src = '(ns my.app\n  (:require other.ns :refer [a]))\n\n(defn f [] 1)\n';
        const issues = findUnusedRequires(src);
        assert.equal(issues.length, 1);
        assert.equal(issues[0].ns, 'other.ns');
    });
});

describe('phelNsHygiene.removeRequireEdit', () => {
    it('drops the whole (:require …) clause with its last entry', () => {
        const src = '(ns my.app\n  (:require [other.ns :refer [a]]))\n\n(defn f [] 1)\n';
        assert.equal(removeIssue(src), '(ns my.app)\n\n(defn f [] 1)\n');
    });

    it('drops a middle entry and the line it sat on', () => {
        const src = `(ns my.app
  (:require [a.one :refer [x]]
            [b.two :refer [y]]
            [c.three :refer [z]]))

(defn f [] (x (z 1)))
`;
        assert.equal(
            removeIssue(src),
            `(ns my.app
  (:require [a.one :refer [x]]
            [c.three :refer [z]]))

(defn f [] (x (z 1)))
`
        );
    });

    it('drops the last entry without leaving a dangling separator', () => {
        const src = '(ns my.app\n  (:require [a.one :refer [x]]\n            [b.two]))\n\n(x 1)\n';
        assert.equal(removeIssue(src), '(ns my.app\n  (:require [a.one :refer [x]]))\n\n(x 1)\n');
    });

    it('drops one name out of a :refer vector', () => {
        const src = '(ns my.app\n  (:require [other.ns :refer [a b]]))\n\n(a 1)\n';
        assert.equal(
            removeIssue(src),
            '(ns my.app\n  (:require [other.ns :refer [a]]))\n\n(a 1)\n'
        );
    });

    it('drops the first name out of a :refer vector', () => {
        const src = '(ns my.app\n  (:require [other.ns :refer [a b]]))\n\n(b 1)\n';
        assert.equal(
            removeIssue(src),
            '(ns my.app\n  (:require [other.ns :refer [b]]))\n\n(b 1)\n'
        );
    });

    it('drops a :refer that would be left empty, keeping the alias', () => {
        const src = '(ns my.app\n  (:require [other.ns :as o :refer [a]]))\n\n(o/run)\n';
        assert.equal(removeIssue(src), '(ns my.app\n  (:require [other.ns :as o]))\n\n(o/run)\n');
    });

    it('leaves the source alone when the issue no longer matches it', () => {
        const issue = findUnusedRequires('(ns a (:require [b.c :refer [x]]))')[0];
        assert.equal(removeRequireEdit('(ns a)', issue), null);
    });
});

describe('phelNsHygiene.requireIssueIn', () => {
    it('finds the entry a range lands in, used or not', () => {
        // What the quick fix does with a `phel/unused-require` from the CLI,
        // whose range covers the entry rather than the whole clause.
        const src = '(ns my.app\n  (:require [other.ns :refer [a]]))\n\n(a 1)\n';
        const at = src.indexOf('other.ns');
        const issue = requireIssueIn(src, at, at + 'other.ns'.length);
        assert.equal(issue?.kind, 'require');
        assert.equal(issue?.ns, 'other.ns');
        assert.equal(apply(src, removeRequireEdit(src, issue!)), '(ns my.app)\n\n(a 1)\n');
    });

    it('answers null for a range outside every entry', () => {
        const src = '(ns my.app\n  (:require [other.ns :refer [a]]))\n\n(a 1)\n';
        const at = src.indexOf('(a 1)');
        assert.equal(requireIssueIn(src, at, at + 5), null);
    });
});

describe('phelNsHygiene.sortRequiresEdit', () => {
    it('answers null when the entries are already in order', () => {
        assert.equal(
            sortRequiresEdit('(ns my.app\n  (:require [a.one]\n            [b.two]))'),
            null
        );
    });

    it('answers null when there is nothing to sort', () => {
        assert.equal(sortRequiresEdit('(ns my.app)'), null);
        assert.equal(sortRequiresEdit('(ns my.app\n  (:require [only.one]))'), null);
    });

    it('sorts the entries and leaves the layout where the writer put it', () => {
        const src = `(ns my.app
  (:require [phel.test :refer [deftest is]]
            [app.core :refer [greet]]
            [phel.bench :refer [defbench]]))
`;
        assert.equal(
            apply(src, sortRequiresEdit(src)),
            `(ns my.app
  (:require [app.core :refer [greet]]
            [phel.bench :refer [defbench]]
            [phel.test :refer [deftest is]]))
`
        );
    });

    it('is idempotent, which is what running it on every save needs', () => {
        const src = '(ns my.app (:require [c.one] [a.two] [b.three]))';
        const once = apply(src, sortRequiresEdit(src));
        assert.equal(once, '(ns my.app (:require [a.two] [b.three] [c.one]))');
        assert.equal(sortRequiresEdit(once), null);
    });

    it('sorts the clauses themselves when there is one per namespace', () => {
        const src = `(ns demo.main-test
  (:require phel.test :refer [deftest is])
  (:require demo.main :refer [greet]))
`;
        const once = apply(src, sortRequiresEdit(src));
        assert.equal(
            once,
            `(ns demo.main-test
  (:require demo.main :refer [greet])
  (:require phel.test :refer [deftest is]))
`
        );
        assert.equal(sortRequiresEdit(once), null);
    });

    it('sorts flat entries with their options attached', () => {
        const src = '(ns my.app (:require phel.string :as str app.core :refer [greet]))';
        assert.equal(
            apply(src, sortRequiresEdit(src)),
            '(ns my.app (:require app.core :refer [greet] phel.string :as str))'
        );
    });
});
