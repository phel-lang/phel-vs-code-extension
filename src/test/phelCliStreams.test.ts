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

    it('loses a multi-byte character split across chunks with a naive toString', async () => {
        // Places the two bytes of `é` either side of the 64 KiB boundary Node
        // reads at, which is what a large `phel lint` run crosses.
        const payload = Buffer.concat([
            Buffer.alloc(65535, 0x78),
            Buffer.from('é', 'utf8'),
            Buffer.alloc(10, 0x79),
        ]);
        const { naive, decoded, chunks } = await collect(payload);

        assert.ok(chunks.length > 1, `expected more than one chunk, got ${chunks.join(',')}`);
        assert.ok(naive.includes('�'), 'the naive path should corrupt the split character');
        assert.ok(!decoded.includes('�'), 'StringDecoder must not corrupt it');
        assert.equal(decoded, payload.toString('utf8'));
    });

    it('agrees with a naive decode when nothing is split', async () => {
        const payload = Buffer.from('café — plain and short', 'utf8');
        const { naive, decoded } = await collect(payload);
        assert.equal(decoded, naive);
        assert.equal(decoded, payload.toString('utf8'));
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
