import * as assert from 'node:assert/strict';
import { columnBaseForVersion, PhelColumnBaseCache } from '../phelVersion';

describe('columnBaseForVersion', function () {
    for (const version of [
        'Phel v0.53.0',
        'Phel v0.54.0',
        'v0.54.0',
        '0.40.1',
        'v0.53.0-beta#1a2b3c4',
    ]) {
        it(`reads ${version} as 0-based`, function () {
            assert.equal(columnBaseForVersion(version), 0);
        });
    }

    for (const version of [
        'Phel v0.54.1',
        'v0.55.0',
        'v1.0.0-rc3',
        'Phel v0.54.0-beta#beda2be',
        'v1.2.0',
    ]) {
        it(`reads ${version} as 1-based`, function () {
            assert.equal(columnBaseForVersion(version), 1);
        });
    }

    it('reads nothing from text without a version', function () {
        assert.equal(columnBaseForVersion('dev-main'), undefined);
        assert.equal(columnBaseForVersion(''), undefined);
    });
});

describe('PhelColumnBaseCache', function () {
    it('asks each binary once', async function () {
        const asked: string[] = [];
        const cache = new PhelColumnBaseCache(
            async (command) => {
                asked.push(command);
                return command === '/old/phel' ? 'Phel v0.54.0' : 'Phel v0.55.0';
            },
            () => undefined
        );

        assert.equal(await cache.get('/old/phel'), 0);
        assert.equal(await cache.get('/old/phel'), 0);
        assert.equal(await cache.get('/new/phel'), 1);
        assert.deepEqual(asked, ['/old/phel', '/new/phel']);
    });

    it('takes an unreadable version as 1-based and says so once', async function () {
        const logged: string[] = [];
        const cache = new PhelColumnBaseCache(
            async () => 'dev-main',
            (message) => logged.push(message)
        );

        assert.equal(await cache.get('/phel'), 1);
        assert.equal(await cache.get('/phel'), 1);
        assert.equal(logged.length, 1);
        assert.match(logged[0], /dev-main/);
    });

    it('takes a failed version call as 1-based', async function () {
        const cache = new PhelColumnBaseCache(
            () => Promise.reject(new Error('spawn ENOENT')),
            () => undefined
        );

        assert.equal(await cache.get('/missing/phel'), 1);
    });

    it('asks again after a clear', async function () {
        let calls = 0;
        const cache = new PhelColumnBaseCache(
            async () => {
                calls++;
                return 'v0.54.0';
            },
            () => undefined
        );

        await cache.get('/phel');
        cache.clear();
        await cache.get('/phel');
        assert.equal(calls, 2);
    });
});
