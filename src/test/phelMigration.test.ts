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

    it('carries the head swap as a fix too, so one code path applies every rewrite', () => {
        const [issue] = findMigrationIssues('(push xs 1)');
        assert.deepEqual(issue.fix, {
            title: "Replace 'push' with 'conj'",
            edits: [{ start: 1, end: 5, text: 'conj' }],
        });
    });

    it('survives unbalanced source without throwing', () => {
        assert.doesNotThrow(() => findMigrationIssues('(push xs'));
        assert.doesNotThrow(() => findMigrationIssues('(defn f [x'));
        assert.doesNotThrow(() => findMigrationIssues('"unterminated'));
        assert.doesNotThrow(() => findMigrationIssues('#| never closed'));
        assert.doesNotThrow(() => findMigrationIssues('(map |(inc $'));
        assert.doesNotThrow(() => findMigrationIssues('`(a ,'));
    });
});

/** Apply every fix in `src`, last edit first so earlier offsets stay valid. */
function applyFixes(src: string): string {
    const edits = findMigrationIssues(src)
        .flatMap((i) => i.fix?.edits ?? [])
        .sort((a, b) => b.start - a.start);
    let out = src;
    for (const e of edits) {
        out = out.slice(0, e.start) + e.text + out.slice(e.end);
    }
    return out;
}

describe('findMigrationIssues — removed reader syntax', () => {
    it('flags a #| |# block comment and rewrites it as ;; lines', () => {
        const src = '(def a 1)\n#| old\n   words |#\n(def b 2)';
        const issues = findMigrationIssues(src);
        assert.deepEqual(
            issues.map((i) => i.name),
            ['#|']
        );
        assert.equal(issues[0].status, 'removed');
        assert.match(issues[0].message, /block comments were removed in Phel 0\.50/);
        assert.equal(applyFixes(src), '(def a 1)\n;; old\n;;   words \n(def b 2)');
    });

    it('offers no block-comment rewrite when code follows the closer on its line', () => {
        const [issue] = findMigrationIssues('#| note |# (def a 1)');
        assert.equal(issue.name, '#|');
        assert.equal(issue.fix, undefined);
    });

    it('does not report the removed syntax when it sits inside the block comment', () => {
        assert.deepEqual(names('#| # not a comment marker\n |(x) |#'), ['#|']);
    });

    it('flags a bare # line comment and rewrites it as ;', () => {
        const src = '# old comment\n(def a 1)';
        const [issue] = findMigrationIssues(src);
        assert.equal(issue.name, '#');
        assert.match(issue.message, /bare `#` line comment was removed/);
        assert.equal(applyFixes(src), '; old comment\n(def a 1)');
    });

    it('leaves every surviving # reader form alone', () => {
        assert.deepEqual(
            names('#(inc %) #{1 2} #_(x) #\'foo #"re" ##Inf #?(:phel 1) #my.app/T {}'),
            []
        );
        // A trailing `#` is a gensym, and `#` inside a string is text.
        assert.deepEqual(names('`(let [x# 1] x#)\n(def s "# not a comment")'), []);
    });

    it('flags a |( short function and rewrites it with % parameters', () => {
        const src = '(map |(+ $1 $2) xs ys) (filter |(pos? $) xs) (apply |(str $&) [1])';
        assert.deepEqual(names(src), ['|(', '|(', '|(']);
        assert.equal(
            applyFixes(src),
            '(map #(+ %1 %2) xs ys) (filter #(pos? %) xs) (apply #(str %&) [1])'
        );
    });

    it('does not rename a $ inside a string in a short function', () => {
        assert.equal(applyFixes('(map |(str "$" $) xs)'), '(map #(str "$" %) xs)');
    });

    it('flags a foo$ gensym only inside a syntax-quote', () => {
        const src = '(defmacro m [x] `(let [v$ ~x] (+ v$ v$)))';
        assert.deepEqual(names(src), ['v$', 'v$', 'v$']);
        assert.equal(applyFixes(src), '(defmacro m [x] `(let [v# ~x] (+ v# v#)))');
        // `$` is the `:post` return value and an ordinary character elsewhere.
        assert.deepEqual(names('(defn f [x] {:post [(pos? $)]} x)'), []);
        assert.deepEqual(names('(def price$ 3)'), []);
    });

    it('flags a , meant as unquote inside a syntax-quote, which now silently quotes', () => {
        const src = '(defmacro m [x xs] `(list ,x ,@xs))';
        const issues = findMigrationIssues(src);
        assert.deepEqual(
            issues.map((i) => i.name),
            [',', ',']
        );
        assert.equal(issues[0].status, 'removed');
        assert.match(issues[0].message, /`x` is quoted rather than unquoted/);
        assert.match(issues[1].message, /write `~@xs`/);
        assert.equal(applyFixes(src), '(defmacro m [x xs] `(list ~x ~@xs))');
    });

    it('ignores a comma that is plain whitespace', () => {
        assert.deepEqual(names('{:a 1, :b 2}'), []);
        assert.deepEqual(names('`{:a 1, :b 2}'), []);
        assert.deepEqual(names('`(a ,)'), []);
        assert.deepEqual(names('(def s "`(a ,b)")'), []);
    });

    it('flags ^:reference and rewrites it as ^:by-ref', () => {
        const src = '(defn fill [^:reference buffer] buffer)';
        const [issue] = findMigrationIssues(src);
        assert.equal(issue.name, '^:reference');
        assert.equal(applyFixes(src), '(defn fill [^:by-ref buffer] buffer)');
        assert.deepEqual(names('(defn fill [^:by-ref buffer] buffer)'), []);
        assert.deepEqual(names('(defn f [^:reference-count n] n)'), []);
    });
});

describe('findMigrationIssues — backslash namespace separator', () => {
    it('flags a \\-separated Phel namespace as deprecated, with the dotted rewrite', () => {
        const src = '(ns my-app\\core (:require phel\\string :as s))';
        const issues = findMigrationIssues(src);
        assert.deepEqual(
            issues.map((i) => [i.name, i.status, i.replacement]),
            [
                ['my-app\\core', 'deprecated', 'my-app.core'],
                ['phel\\string', 'deprecated', 'phel.string'],
            ]
        );
        assert.match(issues[0].message, /namespace separator is deprecated since Phel 0\.50/);
        assert.equal(applyFixes(src), '(ns my-app.core (:require phel.string :as s))');
    });

    it('marks the separator as announced whether or not warn-deprecations is on', () => {
        // ADR 0014: the one deprecation the compiler reports without the flag,
        // because it is the one already scheduled for removal.
        const issues = findMigrationIssues('(ns my-app\\core)\n(new \\phpDocumentor\\Reflection)');
        assert.deepEqual(
            issues.map((i) => i.announcedByDefault),
            [true, true]
        );
        const [deprecatedCall] = findMigrationIssues('(php/new Foo)');
        assert.equal(deprecatedCall.status, 'deprecated');
        assert.equal(deprecatedCall.announcedByDefault, undefined);
    });

    it('flags a fully-qualified call site, which the compiler does not detect', () => {
        const src = '(phel\\string/join "," xs)';
        assert.equal(applyFixes(src), '(phel.string/join "," xs)');
    });

    it('drops the leading marker from a namespaced PHP class', () => {
        assert.equal(applyFixes('(new \\Phel\\Lang\\Keyword "x")'), '(new Phel.Lang.Keyword "x")');
        assert.equal(applyFixes('\\Foo\\Bar/CONST'), 'Foo.Bar/CONST');
        assert.equal(
            applyFixes('(:use \\Symfony\\Component\\Console\\Application)'),
            '(:use Symfony.Component.Console.Application)'
        );
    });

    it('offers no rewrite for a lower-case PHP namespace, which has to be imported', () => {
        const [issue] = findMigrationIssues('(new \\phpDocumentor\\Reflection\\DocBlock)');
        assert.equal(issue.name, '\\phpDocumentor\\Reflection\\DocBlock');
        assert.equal(issue.fix, undefined);
        assert.match(issue.message, /\(:use phpDocumentor\.Reflection\.DocBlock\)/);
    });

    it('leaves a root class, a char literal and a string alone', () => {
        assert.deepEqual(names('(new \\DateTime "now")'), []);
        assert.deepEqual(names('\\newline \\\\ \\( \\u00e9'), []);
        assert.deepEqual(names('(def s "phel\\string")'), []);
        assert.deepEqual(names('#"a\\\\b"'), []);
    });

    it('leaves the dotted spelling alone', () => {
        assert.deepEqual(names('(ns my-app.core (:require phel.string :as s))'), []);
        assert.deepEqual(names('Symfony.Component.Console.Command.Command/SUCCESS'), []);
    });
});

describe('findMigrationIssues — definitions marked :deprecated', () => {
    const defs = new Map([
        ['old-parse', { deprecated: '1.4.0', supersededBy: 'parse-config' }],
        ['legacy', { deprecated: 'true' }],
        ['slow-sum', { deprecated: 'quadratic; use sum' }],
    ]);

    it('flags a call to a workspace definition marked :deprecated', () => {
        const [issue] = findMigrationIssues('(old-parse "x")', { deprecatedDefinitions: defs });
        assert.equal(issue.name, 'old-parse');
        assert.equal(issue.status, 'deprecated');
        assert.equal(
            issue.message,
            '`old-parse` is deprecated (since 1.4.0). Use `parse-config` instead.'
        );
        assert.equal(issue.fix, undefined);
    });

    it('phrases a bare true and a reason the way the compiler does', () => {
        const [legacy] = findMigrationIssues('(legacy)', { deprecatedDefinitions: defs });
        assert.equal(legacy.message, '`legacy` is deprecated.');
        const [slow] = findMigrationIssues('(slow-sum xs)', { deprecatedDefinitions: defs });
        assert.equal(slow.message, '`slow-sum` is deprecated: quadratic; use sum.');
    });

    it('ignores the name outside call position, when shadowed, and when quoted', () => {
        const opts = { deprecatedDefinitions: defs };
        assert.deepEqual(findMigrationIssues('(map old-parse xs)', opts), []);
        assert.deepEqual(findMigrationIssues('(let [old-parse inc] (old-parse 1))', opts), []);
        assert.deepEqual(findMigrationIssues("'(old-parse 1)", opts), []);
    });

    it('still flags a deprecated definition called from the file that defines it', () => {
        const src = '(defn old-parse {:deprecated "1.4.0"} [s] s)\n(old-parse "x")';
        assert.deepEqual(
            findMigrationIssues(src, { deprecatedDefinitions: defs }).map((i) => i.name),
            ['old-parse']
        );
    });
});
