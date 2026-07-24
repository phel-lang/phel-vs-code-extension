import * as assert from 'node:assert/strict';
import { oneLine, formatInlineResult } from '../phelInlineFormat';

describe('phelInlineFormat.oneLine', () => {
    it('collapses whitespace to single spaces', () => {
        assert.equal(oneLine('a\n  b\tc'), 'a b c');
    });

    it('truncates overlong text with an ellipsis', () => {
        assert.equal(oneLine('abcdef', 4), 'abc…');
    });

    it('leaves short text untouched', () => {
        assert.equal(oneLine('short'), 'short');
    });
});

describe('phelInlineFormat.formatInlineResult', () => {
    it('joins returned values on success', () => {
        assert.equal(formatInlineResult(['6'], '', false), '6');
    });

    it('renders nil when there are no values', () => {
        assert.equal(formatInlineResult([], '', false), 'nil');
    });

    it('uses the (collapsed) error text on error', () => {
        assert.equal(formatInlineResult([], 'boom\n at line 1', true), 'boom at line 1');
    });
});
