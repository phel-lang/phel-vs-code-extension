import * as assert from 'assert';
import { findDeftests } from '../phelTestScanner';

describe('findDeftests', function () {
    it('returns nothing when the file has no tests', function () {
        assert.deepStrictEqual(findDeftests('(defn foo [] 1)\n'), []);
    });

    it('finds a single top-level deftest', function () {
        const source = '(deftest my-test\n  (is true))\n';
        const refs = findDeftests(source);
        assert.deepStrictEqual(refs, [{ name: 'my-test', line: 0, nameCol: 9 }]);
    });

    it('finds multiple deftests in order', function () {
        const source = ['(deftest a)', '', '(deftest b)', '', '(deftest c)'].join('\n');
        const refs = findDeftests(source);
        assert.deepStrictEqual(refs, [
            { name: 'a', line: 0, nameCol: 9 },
            { name: 'b', line: 2, nameCol: 9 },
            { name: 'c', line: 4, nameCol: 9 },
        ]);
    });

    it('skips metadata before the test name', function () {
        const source = '(deftest ^:slow my-test\n  (is true))\n';
        const refs = findDeftests(source);
        assert.strictEqual(refs.length, 1);
        assert.strictEqual(refs[0].name, 'my-test');
        assert.strictEqual(refs[0].nameCol, 16);
    });

    it('skips map-form metadata before the test name', function () {
        const source = '(deftest ^{:slow true} my-test\n  (is true))\n';
        const refs = findDeftests(source);
        assert.strictEqual(refs.length, 1);
        assert.strictEqual(refs[0].name, 'my-test');
        assert.strictEqual(refs[0].nameCol, 23);
    });

    it('reports the column relative to the line, not the file', function () {
        const source = 'leading line\n  (deftest indented-test [] (is true))\n';
        const [ref] = findDeftests(source);
        assert.strictEqual(ref.line, 1);
        assert.strictEqual(ref.nameCol, 11);
    });

    it('only matches forms starting at the line head', function () {
        const source = "(println '(deftest fake-name))\n(deftest real)";
        const names = findDeftests(source).map((r) => r.name);
        assert.deepStrictEqual(names, ['real']);
    });

    it('tolerates leading tabs', function () {
        const source = '\t(deftest tab-indent)\n';
        assert.deepStrictEqual(findDeftests(source), [
            { name: 'tab-indent', line: 0, nameCol: 10 },
        ]);
    });

    it('handles names containing punctuation', function () {
        const source = '(deftest a/b-c?-test)\n';
        assert.strictEqual(findDeftests(source)[0].name, 'a/b-c?-test');
    });
});
