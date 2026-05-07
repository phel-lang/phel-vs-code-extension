import * as assert from 'node:assert/strict';
import { buildCallSnippet, isCalleePosition } from '../phelCallSnippet';

describe('phelCallSnippet.buildCallSnippet', () => {
    it('returns null when no signature is provided', () => {
        assert.equal(buildCallSnippet('foo'), null);
    });

    it('returns null for a zero-arg signature', () => {
        assert.equal(buildCallSnippet('foo', '(foo)'), null);
    });

    it('builds tabstops for each parameter', () => {
        const snippet = buildCallSnippet('assoc', '(assoc m k v)');
        assert.equal(snippet, 'assoc ${1:m} ${2:k} ${3:v}');
    });

    it('handles rest parameters', () => {
        const snippet = buildCallSnippet('+', '(+ x & xs)');
        assert.equal(snippet, '+ ${1:x} ${2:& xs}');
    });
});

describe('phelCallSnippet.isCalleePosition', () => {
    it('detects the cursor right after `(`', () => {
        assert.equal(isCalleePosition('(ass'), true);
    });

    it('rejects when there is whitespace after `(`', () => {
        assert.equal(isCalleePosition('( ass'), false);
    });

    it('rejects at the start of a line', () => {
        assert.equal(isCalleePosition(''), false);
    });

    it('rejects in argument position', () => {
        assert.equal(isCalleePosition('(foo bar'), false);
    });
});
