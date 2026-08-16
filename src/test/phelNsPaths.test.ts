import * as assert from 'node:assert/strict';
import {
    deriveNamespace,
    nsToRelativePath,
    pathToNs,
    sourceFileFor,
    testFileFor,
    testFileTemplate,
} from '../phelNsPaths';

/**
 * `tests/main_test.phel`, byte for byte, as `phel init demo` writes it (v0.50,
 * `ProjectTemplateGenerator::generateTestFile`). Pinned rather than generated:
 * this is the shape a Phel programmer expects a test file to open with, and
 * nothing else in the repo would notice it drifting.
 */
const PHEL_INIT_TEST_FILE = `(ns demo.main-test
  (:require phel.test :refer [deftest is])
  (:require demo.main :refer [greet]))

(deftest test-greet
  (is (= "Hello, Phel!" (greet "Phel")))
  (is (= "Hello, Alice!" (greet "Alice"))))
`;

describe('phelNsPaths namespaces and paths', () => {
    it('maps a namespace onto the path Munge encodes it as', () => {
        assert.equal(nsToRelativePath('demo.strings'), 'demo/strings.phel');
        assert.equal(nsToRelativePath('demo.my-app'), 'demo/my_app.phel');
    });

    it('reads a namespace back out of a path', () => {
        assert.equal(pathToNs('demo/strings.phel'), 'demo.strings');
        assert.equal(pathToNs('demo/strings_test.phel'), 'demo.strings-test');
        assert.equal(pathToNs('demo\\strings.phel'), 'demo.strings');
    });
});

describe('phelNsPaths.testFileFor', () => {
    it('names the test of a source file the way phel init does', () => {
        assert.deepEqual(testFileFor({ relPath: 'src/strings.phel', ns: 'demo.strings' }), {
            relPath: 'tests/strings_test.phel',
            ns: 'demo.strings-test',
        });
    });

    it('keeps the directories below the src dir', () => {
        assert.deepEqual(testFileFor({ relPath: 'src/app/core.phel', ns: 'app.core' }), {
            relPath: 'tests/app/core_test.phel',
            ns: 'app.core-test',
        });
    });

    it('follows the project’s configured directories', () => {
        assert.deepEqual(
            testFileFor({ relPath: 'lib/core.phel', ns: 'app.core' }, ['lib'], ['spec']),
            { relPath: 'spec/core_test.phel', ns: 'app.core-test' }
        );
    });

    it('answers null for a file outside every src dir', () => {
        assert.equal(testFileFor({ relPath: 'scripts/one.phel', ns: 'one' }), null);
    });
});

describe('phelNsPaths.sourceFileFor', () => {
    it('walks back from a test file to the file it tests', () => {
        assert.deepEqual(
            sourceFileFor({ relPath: 'tests/app/core_test.phel', ns: 'app.core-test' }),
            { relPath: 'src/app/core.phel', ns: 'app.core' }
        );
    });

    it('answers null for a file under the test dir that is not a test', () => {
        assert.equal(sourceFileFor({ relPath: 'tests/helper.phel', ns: 'app.helper' }), null);
    });

    it('answers null for a source file', () => {
        assert.equal(sourceFileFor({ relPath: 'src/app/core.phel', ns: 'app.core' }), null);
    });
});

describe('phelNsPaths.deriveNamespace', () => {
    it('takes the project prefix off a sibling', () => {
        // `src/strings.phel` declaring `demo.strings` says: drop `src`, prepend
        // `demo`. Nothing in `phel config` says that.
        assert.equal(
            deriveNamespace({
                relPath: 'src/consumer.phel',
                siblings: [{ relPath: 'src/strings.phel', ns: 'demo.strings' }],
            }),
            'demo.consumer'
        );
    });

    it('handles a project whose namespaces have no prefix', () => {
        assert.equal(
            deriveNamespace({
                relPath: 'src/app/fresh.phel',
                siblings: [
                    { relPath: 'src/app/core.phel', ns: 'app.core' },
                    { relPath: 'tests/app/core_test.phel', ns: 'app.core-test' },
                ],
            }),
            'app.fresh'
        );
    });

    it('prefers the sibling nearest in the tree', () => {
        assert.equal(
            deriveNamespace({
                relPath: 'tests/one_test.phel',
                siblings: [
                    { relPath: 'src/strings.phel', ns: 'demo.strings' },
                    { relPath: 'tests/main_test.phel', ns: 'demo.main-test' },
                ],
            }),
            'demo.one-test'
        );
    });

    it('encodes the file name back into a namespace segment', () => {
        assert.equal(
            deriveNamespace({
                relPath: 'src/my_app.phel',
                siblings: [{ relPath: 'src/strings.phel', ns: 'demo.strings' }],
            }),
            'demo.my-app'
        );
    });

    it('falls back to the path when no sibling covers the new file', () => {
        assert.equal(deriveNamespace({ relPath: 'src/app/fresh.phel', siblings: [] }), 'app.fresh');
        assert.equal(
            deriveNamespace({ relPath: 'tests/app/fresh_test.phel', siblings: [] }),
            'app.fresh-test'
        );
    });

    it('ignores a sibling whose namespace says nothing about its path', () => {
        assert.equal(
            deriveNamespace({
                relPath: 'src/app/fresh.phel',
                siblings: [{ relPath: 'src/app/odd.phel', ns: 'completely.unrelated' }],
            }),
            'app.fresh'
        );
    });

    it('answers null for a path with nothing in it', () => {
        assert.equal(deriveNamespace({ relPath: '', siblings: [] }), null);
    });
});

describe('phelNsPaths.testFileTemplate', () => {
    const scaffold = testFileTemplate('demo.strings-test', 'demo.strings');

    it('opens with the header phel init writes', () => {
        const expected = PHEL_INIT_TEST_FILE.split('\n');
        const actual = scaffold.split('\n');
        assert.equal(actual[0], '(ns demo.strings-test');
        // Same clause, same indentation, same refers. Only the parens that
        // close it differ: ours is the last clause of the `(ns …)` form.
        assert.equal(actual[1].replace(/\)+$/, ')'), expected[1]);
    });

    it('leaves out the namespace under test rather than referring nothing from it', () => {
        // `phel init`'s body asserts against the `greet` its own `src/main.phel`
        // defines, which no other namespace has. Requiring `demo.strings`
        // without using it would only trip the unused-require hint, so the
        // scaffold names it in the deftest and in the TODO instead.
        assert.ok(!scaffold.includes('(:require demo.strings'), scaffold);
        assert.ok(scaffold.includes('(deftest test-strings'), scaffold);
        assert.ok(scaffold.includes('TODO: test demo.strings'), scaffold);
    });

    it('ends with a newline, as every file phel init writes does', () => {
        assert.ok(PHEL_INIT_TEST_FILE.endsWith('\n'));
        assert.ok(scaffold.endsWith('\n'));
        assert.ok(!scaffold.endsWith('\n\n'));
    });
});
