// Framing for the DBGp protocol Xdebug speaks.
//
// Each message on the wire is `<length>\0<xml>\0`, where `<length>` is the
// payload size **in bytes**. TCP delivers arbitrary chunks, so a message may
// arrive split anywhere — including in the middle of a multi-byte UTF-8
// character.
//
// Both facts force the buffering to stay in `Buffer`s rather than strings:
//
//   * a byte count cannot index a JS string, whose `.length` is UTF-16 code
//     units — one `é` in a variable value or a file path is enough to make the
//     slice land in the wrong place and desynchronise every later message;
//   * decoding each chunk as it arrives turns a split character into U+FFFD,
//     which no later reassembly can undo.
//
// Decoding therefore happens once, on a complete payload.
//
// Split out of the debug adapter because that class cannot be constructed
// outside a live debug session; this part is pure, so it can be tested.

export class DbgpMessageReader {
    private buffer: Buffer = Buffer.alloc(0);

    /**
     * Add a chunk from the socket and return every complete message it
     * completed, decoded as UTF-8. Incomplete data stays buffered.
     */
    push(chunk: Buffer): string[] {
        this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

        const messages: string[] = [];
        for (;;) {
            const nullIndex = this.buffer.indexOf(0);
            if (nullIndex === -1) {
                break; // length prefix not fully arrived
            }

            const length = Number.parseInt(
                this.buffer.subarray(0, nullIndex).toString('ascii'),
                10
            );
            if (!Number.isInteger(length) || length < 0) {
                // Unparseable prefix: the stream is not recoverable, so drop
                // what we have rather than emit garbage for every later read.
                this.buffer = Buffer.alloc(0);
                break;
            }

            // <length> \0 <payload bytes> \0
            const end = nullIndex + 1 + length + 1;
            if (this.buffer.length < end) {
                break; // payload still in flight
            }

            messages.push(
                this.buffer.subarray(nullIndex + 1, nullIndex + 1 + length).toString('utf8')
            );
            this.buffer = this.buffer.subarray(end);
        }
        return messages;
    }

    /** Drop anything half-received, e.g. when the connection closes. */
    reset(): void {
        this.buffer = Buffer.alloc(0);
    }

    /** Bytes currently held for an incomplete message. */
    get pendingBytes(): number {
        return this.buffer.length;
    }
}
