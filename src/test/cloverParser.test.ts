import * as assert from 'node:assert/strict';
import { parseClover } from '../cloverParser';

// Mirrors Phel's CoverageReport::toClover output exactly.
const CLOVER =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<coverage generated="1700000000">\n' +
    '  <project timestamp="1700000000">\n' +
    '    <file name="/abs/src/phel/core.phel">\n' +
    '      <line num="3" type="stmt" count="1"/>\n' +
    '      <line num="4" type="stmt" count="0"/>\n' +
    '      <line num="7" type="stmt" count="2"/>\n' +
    '      <metrics statements="3" coveredstatements="2"/>\n' +
    '    </file>\n' +
    '    <file name="/abs/src/phel/util.phel">\n' +
    '      <line num="1" type="stmt" count="0"/>\n' +
    '      <metrics statements="1" coveredstatements="0"/>\n' +
    '    </file>\n' +
    '    <metrics statements="4" coveredstatements="2"/>\n' +
    '  </project>\n' +
    '</coverage>\n';

describe('cloverParser.parseClover', () => {
    it('parses files, lines, and per-file metrics', () => {
        const files = parseClover(CLOVER);
        assert.equal(files.length, 2);

        const core = files[0];
        assert.equal(core.file, '/abs/src/phel/core.phel');
        assert.equal(core.statements, 3);
        assert.equal(core.coveredStatements, 2);
        assert.deepEqual(core.lines, [
            { line: 3, covered: true },
            { line: 4, covered: false },
            { line: 7, covered: true },
        ]);

        const util = files[1];
        assert.equal(util.file, '/abs/src/phel/util.phel');
        assert.equal(util.statements, 1);
        assert.equal(util.coveredStatements, 0);
        assert.deepEqual(util.lines, [{ line: 1, covered: false }]);
    });

    it('uses the file-level metrics, not the project-level one', () => {
        // The project <metrics statements="4"> must not leak into the last file.
        const files = parseClover(CLOVER);
        assert.equal(files[1].statements, 1);
    });

    it('treats any positive count as covered', () => {
        const files = parseClover(CLOVER);
        assert.equal(files[0].lines[2].covered, true); // count="2"
    });

    it('decodes entities in file paths', () => {
        const xml =
            '<coverage><project>' +
            '<file name="/a&amp;b/x.phel"><line num="1" type="stmt" count="1"/>' +
            '<metrics statements="1" coveredstatements="1"/></file>' +
            '</project></coverage>';
        const files = parseClover(xml);
        assert.equal(files[0].file, '/a&b/x.phel');
    });

    it('falls back to line counts when metrics are absent', () => {
        const xml =
            '<coverage><project>' +
            '<file name="/x.phel">' +
            '<line num="1" type="stmt" count="1"/>' +
            '<line num="2" type="stmt" count="0"/>' +
            '</file></project></coverage>';
        const files = parseClover(xml);
        assert.equal(files[0].statements, 2);
        assert.equal(files[0].coveredStatements, 1);
    });

    it('returns an empty array for empty or non-coverage input', () => {
        assert.deepEqual(parseClover(''), []);
        assert.deepEqual(parseClover('<coverage></coverage>'), []);
        assert.deepEqual(parseClover('garbage'), []);
    });
});
