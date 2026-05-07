import * as assert from 'node:assert/strict';
import { buildRequireEdit, parseNsForm } from '../phelNsAnalyzer';

function applyEdit(src: string, edit: ReturnType<typeof buildRequireEdit>): string {
    if (!edit) {
        return src;
    }
    return src.slice(0, edit.insertAt) + edit.text + src.slice(edit.insertAt);
}

describe('phelNsAnalyzer.parseNsForm', () => {
    it('parses a bare (ns name) form', () => {
        const ns = parseNsForm('(ns my.app)');
        assert.equal(ns?.name, 'my.app');
        assert.equal(ns?.requireClause, null);
    });

    it('parses a require clause with :refer and :as', () => {
        const src = '(ns my.app\n  (:require [other.ns :refer [a b] :as o]))';
        const ns = parseNsForm(src);
        assert.ok(ns);
        assert.equal(ns?.requireClause?.entries.length, 1);
        const entry = ns?.requireClause?.entries[0];
        assert.equal(entry?.ns, 'other.ns');
        assert.deepEqual(entry?.refer, ['a', 'b']);
        assert.equal(entry?.as, 'o');
    });

    it('returns null when there is no ns form', () => {
        assert.equal(parseNsForm('(defn foo [])'), null);
    });
});

describe('phelNsAnalyzer.buildRequireEdit', () => {
    it('returns null for the same namespace', () => {
        const ns = parseNsForm('(ns my.app)');
        assert.equal(buildRequireEdit(ns, 'my.app', 'foo'), null);
    });

    it('inserts a fresh require clause when none exists', () => {
        const src = '(ns my.app)';
        const ns = parseNsForm(src);
        const edit = buildRequireEdit(ns, 'other.ns', 'foo');
        const result = applyEdit(src, edit);
        assert.equal(result, '(ns my.app\n  (:require [other.ns :refer [foo]]))');
    });

    it('appends a new entry when require exists but ns missing', () => {
        const src = '(ns my.app\n  (:require [a.b :refer [x]]))';
        const ns = parseNsForm(src);
        const edit = buildRequireEdit(ns, 'other.ns', 'foo');
        const result = applyEdit(src, edit);
        assert.match(result, /\[other\.ns :refer \[foo\]\]/);
    });

    it('extends an existing :refer vector', () => {
        const src = '(ns my.app\n  (:require [other.ns :refer [a]]))';
        const ns = parseNsForm(src);
        const edit = buildRequireEdit(ns, 'other.ns', 'b');
        const result = applyEdit(src, edit);
        assert.equal(result, '(ns my.app\n  (:require [other.ns :refer [a b]]))');
    });

    it('adds :refer when entry has only :as', () => {
        const src = '(ns my.app\n  (:require [other.ns :as o]))';
        const ns = parseNsForm(src);
        const edit = buildRequireEdit(ns, 'other.ns', 'foo');
        const result = applyEdit(src, edit);
        assert.equal(result, '(ns my.app\n  (:require [other.ns :as o :refer [foo]]))');
    });

    it('returns null when the symbol is already referred', () => {
        const src = '(ns my.app\n  (:require [other.ns :refer [foo]]))';
        const ns = parseNsForm(src);
        assert.equal(buildRequireEdit(ns, 'other.ns', 'foo'), null);
    });

    it('returns null when there is no ns form', () => {
        assert.equal(buildRequireEdit(null, 'other.ns', 'foo'), null);
    });
});
