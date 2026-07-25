// `runPhelCli` imports `vscode` (for the cancellation token type), so it cannot
// be loaded here. These tests cover the stream-decoding contract it relies on,
// against a real child process, so the boundary case is exercised rather than
// asserted about.

import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Emit `payload` from a child process and collect stdout two ways: the naive
 * per-chunk `toString()` the code used to do, and a `StringDecoder`.
 */
function collect(payload: Buffer): Promise<{ naive: string; decoded: string; chunks: number[] }> {
    const file = join(tmpdir(), `phel-stream-${process.pid}-${Date.now()}.bin`);
    writeFileSync(file, payload);
    return new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, [
            '-e',
            'process.stdout.write(require("fs").readFileSync(process.argv[1]))',
            file,
        ]);
        const decoder = new StringDecoder('utf8');
        const chunks: number[] = [];
        let naive = '';
        let decoded = '';
        proc.stdout.on('data', (d: Buffer) => {
            chunks.push(d.length);
            naive += d.toString();
            decoded += decoder.write(d);
        });
        proc.on('error', reject);
        proc.on('close', () => {
            decoded += decoder.end();
            rmSync(file, { force: true });
            resolve({ naive, decoded, chunks });
        });
    });
}

describe('CLI stream decoding', function () {
    // Spawning a process and pushing 64 KiB through it is slower than a unit test.
    this.timeout(20000);

    it('decodes a large payload with a multi-byte character intact', async () => {
        // Big enough to arrive in more than one chunk on any runtime. Where
        // exactly it splits is up to Node and the OS, so this asserts only what
        // must always hold: the decoded text equals the payload.
        const payload = Buffer.concat([
            Buffer.alloc(65535, 0x78),
            Buffer.from('é', 'utf8'),
            Buffer.alloc(10, 0x79),
        ]);
        const { decoded } = await collect(payload);

        assert.equal(decoded, payload.toString('utf8'));
        assert.ok(!decoded.includes('\ufffd'), 'StringDecoder must not corrupt the character');
    });

    it('agrees with a naive decode when nothing is split', async () => {
        const payload = Buffer.from('café — plain and short', 'utf8');
        const { naive, decoded } = await collect(payload);
        assert.equal(decoded, naive);
        assert.equal(decoded, payload.toString('utf8'));
    });

    it('corrupts a split character without the decoder, and not with it', () => {
        // Deterministic counterpart to the spawn test above: the split is made
        // here rather than left to however the runtime happens to chunk a
        // stream. How a payload divides depends on the platform as much as the
        // Node version — an earlier version of this test asserted the naive
        // path corrupts a spawned stream, which held on macOS (Node 20 and 22
        // alike) and not on CI's Linux Node 20.
        const payload = Buffer.from('café', 'utf8');
        const cut = payload.indexOf(Buffer.from('é', 'utf8')) + 1;
        const [head, tail] = [payload.subarray(0, cut), payload.subarray(cut)];

        const naive = head.toString() + tail.toString();
        assert.ok(naive.includes('\ufffd'), 'per-chunk toString should corrupt it');

        const decoder = new StringDecoder('utf8');
        const decoded = decoder.write(head) + decoder.write(tail) + decoder.end();
        assert.equal(decoded, 'café');
    });

    it('emits nothing for a chunk that is only a partial character', () => {
        // What makes the fix work: the decoder holds an incomplete sequence
        // back instead of substituting U+FFFD for it.
        const decoder = new StringDecoder('utf8');
        const [first, second] = [Buffer.from([0xc3]), Buffer.from([0xa9])];
        assert.equal(decoder.write(first), '');
        assert.equal(decoder.write(second), 'é');
        assert.equal(decoder.end(), '');
    });
});
