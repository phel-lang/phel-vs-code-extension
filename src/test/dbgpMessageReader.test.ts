import * as assert from 'node:assert/strict';
import { DbgpMessageReader } from '../dbgpMessageReader';

/** Frame a payload the way Xdebug does: `<byte length>\0<xml>\0`. */
function frame(xml: string): Buffer {
    const payload = Buffer.from(xml, 'utf8');
    return Buffer.concat([Buffer.from(`${payload.length}\0`, 'ascii'), payload, Buffer.from([0])]);
}

describe('DbgpMessageReader', () => {
    let reader: DbgpMessageReader;

    beforeEach(() => {
        reader = new DbgpMessageReader();
    });

    it('reads a single complete message', () => {
        assert.deepEqual(reader.push(frame('<response id="1"/>')), ['<response id="1"/>']);
        assert.equal(reader.pendingBytes, 0);
    });

    it('reads several messages arriving in one chunk', () => {
        const wire = Buffer.concat([frame('<a/>'), frame('<b/>'), frame('<c/>')]);
        assert.deepEqual(reader.push(wire), ['<a/>', '<b/>', '<c/>']);
    });

    it('waits for a payload that has not fully arrived', () => {
        const f = frame('<response id="1"/>');
        assert.deepEqual(reader.push(f.subarray(0, 8)), []);
        assert.ok(reader.pendingBytes > 0);
        assert.deepEqual(reader.push(f.subarray(8)), ['<response id="1"/>']);
    });

    it('waits for a length prefix split across chunks', () => {
        const f = frame('<a/>');
        assert.deepEqual(reader.push(f.subarray(0, 1)), []);
        assert.deepEqual(reader.push(f.subarray(1)), ['<a/>']);
    });

    it('counts the length prefix in bytes, not characters', () => {
        // The old string-based framing indexed a byte count into a JS string.
        // One `é` made the slice overshoot, pulling in the trailing NUL and
        // leaving the buffer misaligned for everything after it.
        const xml = '<response transaction_id="1" value="café"/>';
        assert.notEqual(Buffer.byteLength(xml, 'utf8'), xml.length);
        assert.deepEqual(reader.push(frame(xml)), [xml]);
    });

    it('does not lose the message after a non-ASCII one', () => {
        // The concrete regression: with the old framing the second message
        // came back as an empty string, so every later response was lost and
        // its command timed out.
        const wire = Buffer.concat([
            frame('<response transaction_id="1" value="café"/>'),
            frame('<response transaction_id="2"/>'),
        ]);
        assert.deepEqual(reader.push(wire), [
            '<response transaction_id="1" value="café"/>',
            '<response transaction_id="2"/>',
        ]);
    });

    it('reassembles a multi-byte character split across chunks', () => {
        // Decoding each chunk as it arrived turned the split `é` into U+FFFD,
        // which no later reassembly could undo.
        const xml = '<response value="café"/>';
        const f = frame(xml);
        const cut = f.indexOf(Buffer.from('é', 'utf8')) + 1;
        const out = [...reader.push(f.subarray(0, cut)), ...reader.push(f.subarray(cut))];
        assert.deepEqual(out, [xml]);
        assert.ok(!out[0].includes('�'));
    });

    it('handles a payload whose bytes contain no ASCII at all', () => {
        const xml = '<response value="日本語のテキスト"/>';
        assert.deepEqual(reader.push(frame(xml)), [xml]);
    });

    it('drops the stream on an unparseable length prefix', () => {
        assert.deepEqual(reader.push(Buffer.from('notanumber\0<a/>\0', 'ascii')), []);
        assert.equal(reader.pendingBytes, 0);
    });

    it('reset discards a half-received message', () => {
        const f = frame('<response id="1"/>');
        reader.push(f.subarray(0, 8));
        reader.reset();
        assert.equal(reader.pendingBytes, 0);
        assert.deepEqual(reader.push(frame('<b/>')), ['<b/>']);
    });

    it('survives a byte-at-a-time delivery', () => {
        const wire = Buffer.concat([frame('<a value="é"/>'), frame('<b/>')]);
        const out: string[] = [];
        for (const byte of wire) {
            out.push(...reader.push(Buffer.from([byte])));
        }
        assert.deepEqual(out, ['<a value="é"/>', '<b/>']);
    });
});
