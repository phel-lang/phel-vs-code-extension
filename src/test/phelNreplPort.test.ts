import * as assert from 'node:assert/strict';
import { NREPL_PORT_FILE, parseNreplPortFile } from '../phelNreplPort';

describe('parseNreplPortFile', () => {
    it('reads the bare port the server writes', () => {
        assert.equal(parseNreplPortFile('7888'), 7888);
        assert.equal(parseNreplPortFile('54321\n'), 54321);
    });

    it('rejects anything that is not a TCP port', () => {
        assert.equal(parseNreplPortFile(''), undefined);
        assert.equal(parseNreplPortFile('0'), undefined);
        assert.equal(parseNreplPortFile('65536'), undefined);
        assert.equal(parseNreplPortFile('127.0.0.1:7888'), undefined);
        assert.equal(parseNreplPortFile('port=7888'), undefined);
    });

    it('names the Clojure-standard file', () => {
        assert.equal(NREPL_PORT_FILE, '.nrepl-port');
    });
});
