import * as assert from 'node:assert/strict';
import { parseReplHistory } from '../phelReplHistory';

/** The shape `appendHistory` writes: a stamp line, the form, a blank line. */
function entry(stamp: string, form: string): string {
    return `;; ${stamp}\n${form}\n\n`;
}

const T1 = '2026-08-16T09:00:00.000Z';
const T2 = '2026-08-16T09:01:00.000Z';
const T3 = '2026-08-16T09:02:00.000Z';

describe('phelReplHistory.parseReplHistory', () => {
    it('reads back what the history writer wrote', () => {
        const text = entry(T1, '(+ 1 2)');
        assert.deepEqual(parseReplHistory(text), [{ stamp: T1, form: '(+ 1 2)' }]);
    });

    it('lists the newest entry first', () => {
        const text = entry(T1, '(a)') + entry(T2, '(b)') + entry(T3, '(c)');
        assert.deepEqual(
            parseReplHistory(text).map((e) => e.form),
            ['(c)', '(b)', '(a)']
        );
    });

    it('lists a form sent twice once, with its latest stamp', () => {
        const text = entry(T1, '(a)') + entry(T2, '(b)') + entry(T3, '(a)');
        assert.deepEqual(parseReplHistory(text), [
            { stamp: T3, form: '(a)' },
            { stamp: T2, form: '(b)' },
        ]);
    });

    it('keeps a form that spans several lines', () => {
        const text = entry(T1, '(defn a []\n  1)');
        assert.deepEqual(parseReplHistory(text), [{ stamp: T1, form: '(defn a []\n  1)' }]);
    });

    it('drops a stamp whose form was never written', () => {
        const text = entry(T1, '(a)') + `;; ${T2}\n`;
        assert.deepEqual(parseReplHistory(text), [{ stamp: T1, form: '(a)' }]);
    });

    it('keeps an entry cut short mid-write', () => {
        const text = entry(T1, '(a)') + `;; ${T2}\n(b`;
        assert.deepEqual(
            parseReplHistory(text).map((e) => e.form),
            ['(b', '(a)']
        );
    });

    it('ignores anything before the first stamp', () => {
        const text = `(orphan)\n\n` + entry(T1, '(a)');
        assert.deepEqual(parseReplHistory(text), [{ stamp: T1, form: '(a)' }]);
    });

    it('reads a file written with CRLF line endings', () => {
        const text = `;; ${T1}\r\n(a)\r\n\r\n`;
        assert.deepEqual(parseReplHistory(text), [{ stamp: T1, form: '(a)' }]);
    });

    it('is empty for an empty file', () => {
        assert.deepEqual(parseReplHistory(''), []);
    });

    it('takes a comment that is not a stamp as part of the form', () => {
        const text = entry(T1, '(a) ; note');
        assert.deepEqual(parseReplHistory(text), [{ stamp: T1, form: '(a) ; note' }]);
    });
});
