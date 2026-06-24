import * as assert from 'node:assert/strict';
import { asString, asStringList, decode, encode, type BencodeValue } from '../bencode';

function roundtrip(value: BencodeValue): BencodeValue {
    const buf = encode(value);
    const { values, consumed } = decode(buf);
    assert.equal(consumed, buf.length, 'should consume the whole buffer');
    assert.equal(values.length, 1, 'should decode exactly one value');
    return values[0];
}

describe('bencode.encode', () => {
    it('encodes integers', () => {
        assert.equal(encode(42).toString(), 'i42e');
        assert.equal(encode(0).toString(), 'i0e');
        assert.equal(encode(-7).toString(), 'i-7e');
    });

    it('encodes byte strings with utf-8 byte length', () => {
        assert.equal(encode('spam').toString(), '4:spam');
        assert.equal(encode('').toString(), '0:');
        // 'é' is two bytes in UTF-8
        assert.equal(encode('é').toString(), '2:é');
    });

    it('encodes lists', () => {
        assert.equal(encode(['spam', 42]).toString(), 'l4:spami42ee');
        assert.equal(encode([]).toString(), 'le');
    });

    it('encodes dictionaries with sorted keys', () => {
        assert.equal(
            encode({ op: 'eval', code: '(+ 1 2)' }).toString(),
            'd4:code7:(+ 1 2)2:op4:evale'
        );
    });

    it('rejects non-integer numbers', () => {
        assert.throws(() => encode(3.14));
    });
});

describe('bencode.decode', () => {
    it('round-trips nested structures', () => {
        const value: BencodeValue = {
            op: 'eval',
            id: '1',
            session: 'abc',
            nested: { status: ['done'], items: [1, 2, 3] },
        };
        assert.deepEqual(roundtrip(value), value);
    });

    it('decodes multiple concatenated frames', () => {
        const a = encode({ id: '1', status: ['done'] });
        const b = encode({ id: '2', value: '42' });
        const { values, consumed } = decode(Buffer.concat([a, b]));
        assert.equal(values.length, 2);
        assert.equal(consumed, a.length + b.length);
        assert.deepEqual(values[0], { id: '1', status: ['done'] });
        assert.deepEqual(values[1], { id: '2', value: '42' });
    });

    it('stops at a partial frame and reports bytes consumed', () => {
        const whole = encode({ id: '1', status: ['done'] });
        const partial = encode({ id: '2', value: 'longvalue' });
        const truncated = Buffer.concat([whole, partial.subarray(0, partial.length - 3)]);
        const { values, consumed } = decode(truncated);
        assert.equal(values.length, 1, 'only the complete frame decodes');
        assert.equal(consumed, whole.length, 'consumes only the complete frame');
        // Feeding the remainder + the rest should then decode the second frame.
        const rest = Buffer.concat([
            truncated.subarray(consumed),
            partial.subarray(partial.length - 3),
        ]);
        const second = decode(rest);
        assert.equal(second.values.length, 1);
        assert.deepEqual(second.values[0], { id: '2', value: 'longvalue' });
    });

    it('returns nothing for an empty or incomplete leading frame', () => {
        assert.deepEqual(decode(Buffer.from('')), { values: [], consumed: 0 });
        assert.deepEqual(decode(Buffer.from('d2:id')), { values: [], consumed: 0 });
        assert.deepEqual(decode(Buffer.from('i42')), { values: [], consumed: 0 });
    });

    it('handles string payloads containing bencode delimiters', () => {
        // A value whose bytes look like bencode control chars must not confuse the parser.
        const tricky = { out: 'lei42e:d' };
        assert.deepEqual(roundtrip(tricky), tricky);
    });
});

describe('bencode coercion helpers', () => {
    it('asString coerces strings and numbers', () => {
        assert.equal(asString('hi'), 'hi');
        assert.equal(asString(42), '42');
        assert.equal(asString(undefined), '');
        assert.equal(asString(['x']), '');
    });

    it('asStringList coerces lists', () => {
        assert.deepEqual(asStringList(['done', 'error']), ['done', 'error']);
        assert.deepEqual(asStringList(undefined), []);
        assert.deepEqual(asStringList('done'), []);
    });
});
