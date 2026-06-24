import * as assert from 'node:assert/strict';
import { decodeEntities, readAttr, toInt } from '../xml';

describe('xml.readAttr', () => {
    it('reads double-quoted values', () => {
        assert.equal(readAttr('name="t" line="4"', 'name'), 't');
        assert.equal(readAttr('name="t" line="4"', 'line'), '4');
    });

    it('reads single-quoted values', () => {
        assert.equal(readAttr("name='t'", 'name'), 't');
    });

    it('returns undefined for a missing attribute', () => {
        assert.equal(readAttr('name="t"', 'file'), undefined);
    });

    it('returns empty string for an empty value', () => {
        assert.equal(readAttr('classname=""', 'classname'), '');
    });

    it('matches on a word boundary, not a substring', () => {
        // `num` must not match inside `linenum`.
        assert.equal(readAttr('linenum="9" num="3"', 'num'), '3');
    });
});

describe('xml.decodeEntities', () => {
    it('decodes the named entities', () => {
        assert.equal(
            decodeEntities('a &lt;b&gt; &amp; &quot;c&quot; &apos;d&apos;'),
            'a <b> & "c" \'d\''
        );
    });

    it('decodes decimal and hex numeric entities', () => {
        assert.equal(decodeEntities('&#65;&#x42;'), 'AB');
    });

    it('does not double-decode an escaped ampersand', () => {
        // &amp;lt; should become &lt; (literal), not <
        assert.equal(decodeEntities('&amp;lt;'), '&lt;');
    });

    it('returns the input unchanged when there are no entities', () => {
        assert.equal(decodeEntities('/abs/path/file.phel'), '/abs/path/file.phel');
    });
});

describe('xml.toInt', () => {
    it('parses integers', () => {
        assert.equal(toInt('42'), 42);
        assert.equal(toInt('0'), 0);
    });

    it('returns undefined for missing or non-numeric values', () => {
        assert.equal(toInt(undefined), undefined);
        assert.equal(toInt(''), undefined);
        assert.equal(toInt('abc'), undefined);
    });
});
