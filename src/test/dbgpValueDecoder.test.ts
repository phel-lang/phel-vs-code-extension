import * as assert from 'node:assert/strict';
import { decodeDbgpCdata, isBase64Encoded } from '../dbgpValueDecoder';

// Element markup captured from a live Xdebug session (`context_get -d 0` over
// a script holding one of each type). Xdebug marks a payload base64 only for
// the string; int, float and bool carry no encoding attribute.
const REAL = {
    string: '<property name="$accented" fullname="$accented" type="string" size="5" encoding="base64">',
    int: '<property name="$number" fullname="$number" type="int">',
    float: '<property name="$fl" fullname="$fl" type="float">',
    bool: '<property name="$flag" fullname="$flag" type="bool">',
};

describe('isBase64Encoded', () => {
    it('is true only when the element declares it', () => {
        assert.equal(isBase64Encoded(REAL.string), true);
        assert.equal(isBase64Encoded(REAL.int), false);
        assert.equal(isBase64Encoded(REAL.float), false);
        assert.equal(isBase64Encoded(REAL.bool), false);
    });

    it('is not fooled by the word appearing elsewhere', () => {
        assert.equal(isBase64Encoded('<property name="$my_base64_thing" type="int">'), false);
        assert.equal(isBase64Encoded('<property type="string" xencoding="base64">'), false);
    });
});

describe('decodeDbgpCdata', () => {
    it('decodes a base64 string payload', () => {
        // Y2Fmw6k= is what Xdebug actually sent for "café".
        assert.equal(decodeDbgpCdata('Y2Fmw6k=', REAL.string), 'café');
    });

    it('leaves an int, float and bool alone', () => {
        // The regression: decoding these unconditionally rendered `42` and
        // `3.5` as U+FFFD and `true` as the empty string, because
        // Buffer.from(x, 'base64') silently drops anything that is not base64.
        assert.equal(decodeDbgpCdata('42', REAL.int), '42');
        assert.equal(decodeDbgpCdata('3.5', REAL.float), '3.5');
        assert.equal(decodeDbgpCdata('1', REAL.bool), '1');
    });

    it('does not mangle a plain payload that looks like base64', () => {
        // `data` is valid base64, so the old code would have "decoded" it.
        assert.equal(decodeDbgpCdata('data', REAL.int), 'data');
    });

    it('handles an empty payload either way', () => {
        assert.equal(decodeDbgpCdata('', REAL.string), '');
        assert.equal(decodeDbgpCdata('', REAL.int), '');
    });

    it('decodes multi-byte content in a base64 payload', () => {
        const encoded = Buffer.from('日本語', 'utf8').toString('base64');
        assert.equal(decodeDbgpCdata(encoded, REAL.string), '日本語');
    });
});
