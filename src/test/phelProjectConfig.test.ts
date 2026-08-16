import * as assert from 'node:assert/strict';
import {
    type PhelProjectConfig,
    ProjectConfigCache,
    parseJsonLoose,
    parsePhelConfigJson,
} from '../phelProjectConfig';

/**
 * Real output of `phel config --format=json`, captured in the phel-lang
 * checkout itself (only the temp path is shortened). Every key the extension
 * reads has to survive the ones it does not.
 */
const REAL_OUTPUT = `{
    "src-dirs": [
        "src/phel"
    ],
    "test-dirs": [
        "tests/phel"
    ],
    "vendor-dir": "vendor",
    "error-log-file": ".phel/error.log",
    "out": {
        "main-phel-namespace": "phel.core",
        "dir": "out",
        "main-php-filename": "index.php",
        "main-php-path": "out/index.php"
    },
    "export": {
        "target-directory": "src/PhelGenerated",
        "from-directories": [
            "src/phel"
        ],
        "namespace-prefix": "PhelGenerated"
    },
    "ignore-when-building": [
        "src/phel/local.phel"
    ],
    "no-cache-when-building": [],
    "keep-generated-temp-files": false,
    "temp-dir": "/var/folders/T/phel/tmp",
    "format-dirs": [
        "src/phel",
        "tests/phel"
    ],
    "asserts-enabled": true,
    "warn-deprecations": false,
    "enable-namespace-cache": true,
    "enable-compiled-code-cache": true,
    "cache-dir": ".phel/cache",
    "phel-dir": "",
    "optimization-level": 0
}
`;

describe('phelProjectConfig.parsePhelConfigJson', () => {
    it('reads every key the extension acts on from real CLI output', () => {
        const config = parsePhelConfigJson(REAL_OUTPUT);
        assert.deepEqual(config, {
            srcDirs: ['src/phel'],
            testDirs: ['tests/phel'],
            vendorDir: 'vendor',
            tempDir: '/var/folders/T/phel/tmp',
            cacheDir: '.phel/cache',
            warnDeprecations: false,
            formatDirs: ['src/phel', 'tests/phel'],
        });
    });

    it('reads the JSON out of a banner and a trailing notice', () => {
        const noisy = `PHP Deprecated:  something in bootstrap.php on line 3\n${REAL_OUTPUT}\nDone.\n`;
        assert.deepEqual(parsePhelConfigJson(noisy), parsePhelConfigJson(REAL_OUTPUT));
    });

    it('reports warn-deprecations only when the CLI printed true', () => {
        assert.equal(parsePhelConfigJson('{"warn-deprecations": true}')?.warnDeprecations, true);
        assert.equal(parsePhelConfigJson('{"warn-deprecations": "yes"}')?.warnDeprecations, false);
        assert.equal(parsePhelConfigJson('{}')?.warnDeprecations, false);
    });

    it('leaves a key the CLI did not print empty rather than guessing a default', () => {
        assert.deepEqual(parsePhelConfigJson('{}'), {
            srcDirs: [],
            testDirs: [],
            vendorDir: '',
            tempDir: '',
            cacheDir: '',
            warnDeprecations: false,
            formatDirs: [],
        });
    });

    it('drops entries of the wrong type instead of trusting them', () => {
        const config = parsePhelConfigJson('{"src-dirs": ["src", 7, "", null], "test-dirs": "t"}');
        assert.deepEqual(config?.srcDirs, ['src']);
        assert.deepEqual(config?.testDirs, []);
    });

    it('returns null when nothing in the output is a JSON object', () => {
        assert.equal(parsePhelConfigJson(''), null);
        assert.equal(parsePhelConfigJson('Command "config" is not defined.'), null);
        assert.equal(parsePhelConfigJson('{ broken'), null);
        assert.equal(parsePhelConfigJson('["src"]'), null);
        assert.equal(parsePhelConfigJson('null'), null);
    });
});

describe('phelProjectConfig.parseJsonLoose', () => {
    it('parses clean JSON and JSON surrounded by noise', () => {
        assert.deepEqual(parseJsonLoose('{"a": 1}'), { a: 1 });
        assert.deepEqual(parseJsonLoose('warning\n{"a": 1}\nbye'), { a: 1 });
    });

    it('gives up rather than returning half an object', () => {
        assert.equal(parseJsonLoose('{"a": '), null);
        assert.equal(parseJsonLoose('no json here'), null);
    });
});

describe('phelProjectConfig.ProjectConfigCache', () => {
    const config = (cacheDir: string): PhelProjectConfig => ({
        srcDirs: [],
        testDirs: [],
        vendorDir: '',
        tempDir: '',
        cacheDir,
        warnDeprecations: false,
        formatDirs: [],
    });

    it('runs one load for every caller waiting on the same key', async () => {
        let calls = 0;
        const cache = new ProjectConfigCache<string>(async (key) => {
            calls += 1;
            return config(key);
        });

        const [first, second] = await Promise.all([cache.get('a'), cache.get('a')]);
        assert.equal(calls, 1);
        assert.equal(first, second);
        // A third caller after the load settled is served from the cache.
        await cache.get('a');
        assert.equal(calls, 1);
    });

    it('loads each key separately', async () => {
        const cache = new ProjectConfigCache<string>(async (key) => config(key));
        assert.equal((await cache.get('a'))?.cacheDir, 'a');
        assert.equal((await cache.get('b'))?.cacheDir, 'b');
    });

    it('peeks nothing until a load has settled', async () => {
        let release = (): void => undefined;
        const cache = new ProjectConfigCache<string>(
            () => new Promise((resolve) => (release = () => resolve(config('a'))))
        );

        const pending = cache.get('a');
        assert.equal(cache.peek('a'), undefined);
        release();
        await pending;
        assert.equal(cache.peek('a')?.cacheDir, 'a');
    });

    it('caches a null answer, so a missing CLI is not spawned for again', async () => {
        let calls = 0;
        const cache = new ProjectConfigCache<string>(async () => {
            calls += 1;
            return null;
        });

        assert.equal(await cache.get('a'), null);
        assert.equal(await cache.get('a'), null);
        assert.equal(cache.peek('a'), null);
        assert.equal(calls, 1);
    });

    it('reloads after invalidate and tells listeners about both halves', async () => {
        let calls = 0;
        const cache = new ProjectConfigCache<string>(async () => config(`load-${++calls}`));
        const changed: string[] = [];
        cache.onDidChange((key) => changed.push(key));

        assert.equal((await cache.get('a'))?.cacheDir, 'load-1');
        cache.invalidate('a');
        assert.equal(cache.peek('a'), undefined);
        assert.equal((await cache.get('a'))?.cacheDir, 'load-2');
        // The completed load, the invalidation, and the load that replaced it.
        assert.deepEqual(changed, ['a', 'a', 'a']);
    });

    it('stays quiet when invalidating a key it never loaded', () => {
        const cache = new ProjectConfigCache<string>(async () => null);
        const changed: string[] = [];
        cache.onDidChange((key) => changed.push(key));
        cache.invalidate('a');
        assert.deepEqual(changed, []);
    });

    it('does not cache a load that was invalidated while it ran', async () => {
        let calls = 0;
        let release = (): void => undefined;
        const cache = new ProjectConfigCache<string>(
            () =>
                new Promise((resolve) => {
                    calls += 1;
                    release = () => resolve(config(`load-${calls}`));
                })
        );

        const pending = cache.get('a');
        cache.invalidate('a');
        release();
        // The caller still gets the answer it waited for, but the next reader
        // asks again rather than being served a config that is already stale.
        assert.equal((await pending)?.cacheDir, 'load-1');
        assert.equal(cache.peek('a'), undefined);
        const reloaded = cache.get('a');
        release();
        assert.equal((await reloaded)?.cacheDir, 'load-2');
    });

    it('invalidates every loaded key at once', async () => {
        let calls = 0;
        const cache = new ProjectConfigCache<string>(async () => config(`load-${++calls}`));
        await Promise.all([cache.get('a'), cache.get('b')]);
        cache.invalidateAll();
        assert.equal(cache.peek('a'), undefined);
        assert.equal(cache.peek('b'), undefined);
    });

    it('stops calling a listener that unsubscribed', async () => {
        const cache = new ProjectConfigCache<string>(async () => null);
        let calls = 0;
        const off = cache.onDidChange(() => (calls += 1));
        await cache.get('a');
        assert.equal(calls, 1);
        off();
        cache.invalidate('a');
        assert.equal(calls, 1);
    });
});
