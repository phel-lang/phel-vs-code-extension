import * as assert from 'node:assert/strict';
import { aliasMapFromSource, buildRequireEdit, parseNsForm } from '../phelNsAnalyzer';

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

describe('phelNsAnalyzer.aliasMapFromSource', () => {
    it('returns an empty map when there is no ns form', () => {
        assert.equal(aliasMapFromSource('(defn foo [])').size, 0);
    });

    it('returns an empty map when there is no :require clause', () => {
        assert.equal(aliasMapFromSource('(ns my.app)').size, 0);
    });

    it('extracts every :as alias from the require clause', () => {
        const src = `(ns my.app
  (:require [phelgeon.render :as r]
            [phelgeon.input :as i]
            [other.ns]))`;
        const map = aliasMapFromSource(src);
        assert.equal(map.size, 2);
        assert.equal(map.get('r'), 'phelgeon.render');
        assert.equal(map.get('i'), 'phelgeon.input');
    });

    it('reads a flat entry, the legacy shape the compiler still accepts', () => {
        const map = aliasMapFromSource('(ns my.app (:require phel.string :as str))');
        assert.equal(map.get('str'), 'phel.string');
    });

    it('reads several flat entries in one clause', () => {
        const map = aliasMapFromSource(
            '(ns my.app (:require phel.string :as str phel.html :as h))'
        );
        assert.equal(map.get('str'), 'phel.string');
        assert.equal(map.get('h'), 'phel.html');
    });

    it('reads flat and vector entries mixed in one clause', () => {
        const map = aliasMapFromSource(
            '(ns my.app (:require phel.string :as str [phel.test :as t :refer [is]]))'
        );
        assert.equal(map.get('str'), 'phel.string');
        assert.equal(map.get('t'), 'phel.test');
    });

    it('normalises the backslash separator Phel sources use', () => {
        // `phel\string` is what phel's own code writes; the compiler and the
        // symbol corpus both use the dotted form.
        assert.equal(
            aliasMapFromSource('(ns a (:require [phel\\string :as str]))').get('str'),
            'phel.string'
        );
        assert.equal(
            aliasMapFromSource('(ns a (:require phel\\string :as str))').get('str'),
            'phel.string'
        );
    });
});

describe('phelNsAnalyzer flat require entries', () => {
    it('captures :refer names on a flat entry', () => {
        const ns = parseNsForm('(ns a (:require phel.test :refer [deftest is]))');
        const entry = ns?.requireClause?.entries[0];
        assert.equal(entry?.ns, 'phel.test');
        assert.deepEqual(entry?.refer, ['deftest', 'is']);
    });

    it('does not merge two flat entries into one', () => {
        const ns = parseNsForm('(ns a (:require phel.string :as str phel.html :as h))');
        assert.deepEqual(
            ns?.requireClause?.entries.map((e) => e.ns),
            ['phel.string', 'phel.html']
        );
    });

    it('treats a backslash-spelled entry as already required', () => {
        // buildRequireEdit compares against the normalised namespace, so an
        // auto-import must not add a duplicate entry for the same namespace.
        const ns = parseNsForm('(ns a (:require [phel\\string :as str]))');
        const edit = buildRequireEdit(ns, 'phel.string', 'blank?');
        assert.ok(edit);
        assert.ok(edit.text.includes(':refer [blank?]'));
        assert.ok(!edit.text.includes('[phel.string :refer'));
    });
});
