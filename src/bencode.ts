// Minimal bencode codec for the nREPL wire protocol.
//
// nREPL frames are bencoded dictionaries. We support the four bencode types:
//   integers     i<n>e
//   byte strings <len>:<bytes>
//   lists        l<elem...>e
//   dictionaries d<key><value>...e   (keys are byte strings, sorted on encode)
//
// Decoding is incremental: a TCP read may contain a partial frame or several
// frames, so `decode` returns every complete value it can parse plus the
// number of bytes consumed, leaving any trailing partial frame in the buffer.

export type BencodeValue = number | string | BencodeValue[] | { [key: string]: BencodeValue };

const COLON = 0x3a; // ':'
const END = 0x65; // 'e'
const INT = 0x69; // 'i'
const LIST = 0x6c; // 'l'
const DICT = 0x64; // 'd'
const ZERO = 0x30; // '0'
const NINE = 0x39; // '9'

export function encode(value: BencodeValue): Buffer {
    const parts: Buffer[] = [];
    encodeInto(value, parts);
    return Buffer.concat(parts);
}

function encodeInto(value: BencodeValue, out: Buffer[]): void {
    if (typeof value === 'number') {
        if (!Number.isInteger(value)) {
            throw new Error(`bencode: cannot encode non-integer number ${value}`);
        }
        out.push(Buffer.from(`i${value}e`, 'utf-8'));
        return;
    }
    if (typeof value === 'string') {
        const buf = Buffer.from(value, 'utf-8');
        out.push(Buffer.from(`${buf.length}:`, 'utf-8'), buf);
        return;
    }
    if (Array.isArray(value)) {
        out.push(Buffer.from('l', 'utf-8'));
        for (const item of value) {
            encodeInto(item, out);
        }
        out.push(Buffer.from('e', 'utf-8'));
        return;
    }
    // dictionary — keys sorted lexicographically per the spec
    out.push(Buffer.from('d', 'utf-8'));
    for (const key of Object.keys(value).sort()) {
        encodeInto(key, out);
        encodeInto(value[key], out);
    }
    out.push(Buffer.from('e', 'utf-8'));
}

export interface DecodeResult {
    /** Fully parsed top-level values. */
    values: BencodeValue[];
    /** Number of bytes consumed from the start of the buffer. */
    consumed: number;
}

/**
 * Decode as many complete bencode values from the front of `buf` as possible.
 * Stops at the first incomplete value, returning the count of bytes consumed
 * so the caller can keep the remainder for the next read.
 */
export function decode(buf: Buffer): DecodeResult {
    const values: BencodeValue[] = [];
    let offset = 0;
    while (offset < buf.length) {
        const parsed = parseValue(buf, offset);
        if (parsed === null) {
            break;
        }
        values.push(parsed.value);
        offset = parsed.offset;
    }
    return { values, consumed: offset };
}

interface Parsed {
    value: BencodeValue;
    offset: number;
}

function parseValue(buf: Buffer, offset: number): Parsed | null {
    if (offset >= buf.length) {
        return null;
    }
    const tag = buf[offset];
    if (tag === INT) {
        return parseInt_(buf, offset);
    }
    if (tag === LIST) {
        return parseList(buf, offset);
    }
    if (tag === DICT) {
        return parseDict(buf, offset);
    }
    if (tag >= ZERO && tag <= NINE) {
        return parseString(buf, offset);
    }
    throw new Error(`bencode: unexpected byte 0x${tag.toString(16)} at offset ${offset}`);
}

function parseInt_(buf: Buffer, offset: number): Parsed | null {
    const end = buf.indexOf(END, offset + 1);
    if (end === -1) {
        return null;
    }
    const text = buf.toString('utf-8', offset + 1, end);
    if (!/^-?\d+$/.test(text)) {
        throw new Error(`bencode: invalid integer "${text}"`);
    }
    return { value: Number.parseInt(text, 10), offset: end + 1 };
}

function parseString(buf: Buffer, offset: number): Parsed | null {
    const colon = buf.indexOf(COLON, offset);
    if (colon === -1) {
        return null;
    }
    const lenText = buf.toString('utf-8', offset, colon);
    if (!/^\d+$/.test(lenText)) {
        throw new Error(`bencode: invalid string length "${lenText}"`);
    }
    const len = Number.parseInt(lenText, 10);
    const start = colon + 1;
    const end = start + len;
    if (end > buf.length) {
        return null; // incomplete
    }
    return { value: buf.toString('utf-8', start, end), offset: end };
}

function parseList(buf: Buffer, offset: number): Parsed | null {
    const items: BencodeValue[] = [];
    let cursor = offset + 1;
    while (cursor < buf.length && buf[cursor] !== END) {
        const parsed = parseValue(buf, cursor);
        if (parsed === null) {
            return null;
        }
        items.push(parsed.value);
        cursor = parsed.offset;
    }
    if (cursor >= buf.length) {
        return null; // no terminating 'e' yet
    }
    return { value: items, offset: cursor + 1 };
}

function parseDict(buf: Buffer, offset: number): Parsed | null {
    const dict: { [key: string]: BencodeValue } = {};
    let cursor = offset + 1;
    while (cursor < buf.length && buf[cursor] !== END) {
        const key = parseString(buf, cursor);
        if (key === null) {
            return null;
        }
        const value = parseValue(buf, key.offset);
        if (value === null) {
            return null;
        }
        dict[String(key.value)] = value.value;
        cursor = value.offset;
    }
    if (cursor >= buf.length) {
        return null; // no terminating 'e' yet
    }
    return { value: dict, offset: cursor + 1 };
}

/** Coerce a bencode value that should be a string (nREPL sends most as byte strings). */
export function asString(value: BencodeValue | undefined): string {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number') {
        return String(value);
    }
    return '';
}

/** Coerce a bencode value that should be a list of strings (e.g. `status`). */
export function asStringList(value: BencodeValue | undefined): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map((v) => asString(v));
}
