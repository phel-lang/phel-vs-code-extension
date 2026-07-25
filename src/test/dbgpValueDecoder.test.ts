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

// Error responses captured from the same live session — all plain text.
const REAL_ERRORS = [
    '<error code="205"><message><![CDATA[no such breakpoint]]></message></error>',
    '<error code="100"><message><![CDATA[can not open file]]></message></error>',
    '<error code="3"><message><![CDATA[invalid or missing options]]></message></error>',
];

describe('decodeDbgpCdata', () => {
    it('leaves an error message alone, because Xdebug sends those plain', () => {
        // Base64-decoding these turned "no such breakpoint" into bytes like
        // "\ufffd\ufffd.r\u0016\ufffdy\ufffd)\ufffd)\ufffd", so every engine error
        // reached the user as garbage instead of the reason.
        const messages = REAL_ERRORS.map((xml) => {
            const cdata = /<!\[CDATA\[(.*?)\]\]>/s.exec(xml)?.[1] ?? '';
            return decodeDbgpCdata(cdata, xml);
        });
        assert.deepEqual(messages, [
            'no such breakpoint',
            'can not open file',
            'invalid or missing options',
        ]);
    });

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
