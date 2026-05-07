import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { resolveExecutablePath } from '../phelExecutablePath';

describe('phelExecutablePath.resolveExecutablePath', () => {
    const cwd = path.resolve('/ws');

    it('uses explicit override when set', () => {
        const out = resolveExecutablePath('bin/phel', 'fallback/phel', cwd);
        assert.equal(out, path.join(cwd, 'bin/phel'));
    });

    it('falls back to workspace executablePath when override is missing', () => {
        const out = resolveExecutablePath(undefined, 'tools/phel', cwd);
        assert.equal(out, path.join(cwd, 'tools/phel'));
    });

    it('uses built-in default when nothing is set', () => {
        const out = resolveExecutablePath(undefined, undefined, cwd);
        assert.equal(out, path.join(cwd, 'vendor/bin/phel'));
    });

    it('returns absolute paths unchanged', () => {
        const abs = path.resolve('/usr/local/bin/phel');
        assert.equal(resolveExecutablePath(abs, undefined, cwd), abs);
        assert.equal(resolveExecutablePath(undefined, abs, cwd), abs);
    });

    it('joins relative paths against the given cwd', () => {
        const out = resolveExecutablePath('bin/phel', undefined, path.resolve('/elsewhere'));
        assert.equal(out, path.join(path.resolve('/elsewhere'), 'bin/phel'));
    });
});
