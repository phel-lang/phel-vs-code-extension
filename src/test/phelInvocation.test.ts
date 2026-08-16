import * as assert from 'node:assert/strict';
import { coverageEnv, toInvocation } from '../phelInvocation';

/** Nothing on disk: every `exists` probe fails unless a path is listed. */
const existing =
    (...paths: string[]) =>
    (p: string): boolean =>
        paths.includes(p);

const WIN = { platform: 'win32' as NodeJS.Platform };
const POSIX = { platform: 'linux' as NodeJS.Platform };

describe('phelInvocation.toInvocation', () => {
    it('leaves the command untouched outside Windows', () => {
        const inv = toInvocation('/ws/vendor/bin/phel', ['lint', 'a.phel'], {
            ...POSIX,
            exists: existing('/ws/vendor/bin/phel'),
        });
        assert.deepEqual(inv, { file: '/ws/vendor/bin/phel', args: ['lint', 'a.phel'] });
    });

    it('leaves a Windows .exe untouched', () => {
        const inv = toInvocation('C:\\tools\\phel.exe', ['repl'], { ...WIN, exists: existing() });
        assert.deepEqual(inv, { file: 'C:\\tools\\phel.exe', args: ['repl'] });
    });

    it('runs the Composer PHP proxy through php on Windows', () => {
        const command = 'C:\\ws\\vendor\\bin\\phel';
        const inv = toInvocation(command, ['nrepl', '--port=0'], {
            ...WIN,
            exists: existing(command),
        });
        assert.deepEqual(inv, { file: 'php', args: [command, 'nrepl', '--port=0'] });
        assert.equal(inv.shell, undefined);
    });

    it('strips .bat / .cmd to find the PHP proxy next to it', () => {
        const proxy = 'C:\\ws\\vendor\\bin\\phel';
        for (const ext of ['.bat', '.BAT', '.cmd']) {
            const inv = toInvocation(`${proxy}${ext}`, ['format'], {
                ...WIN,
                exists: existing(proxy),
            });
            assert.deepEqual(inv, { file: 'php', args: [proxy, 'format'] });
        }
    });

    it('prefers the .bat proxy when only that one is on disk', () => {
        const command = 'C:\\ws\\vendor\\bin\\phel';
        const inv = toInvocation(command, ['lint'], {
            ...WIN,
            exists: existing(`${command}.bat`),
        });
        assert.deepEqual(inv, { file: `${command}.bat`, args: ['lint'], shell: true });
    });

    it('shells out for a command with no proxy on disk (e.g. phel on PATH)', () => {
        const inv = toInvocation('phel', ['build'], { ...WIN, exists: existing() });
        assert.deepEqual(inv, { file: 'phel', args: ['build'], shell: true });
    });

    it('shells out for a .bat the user pointed at directly', () => {
        const inv = toInvocation('C:\\tools\\phel.bat', ['test'], { ...WIN, exists: existing() });
        assert.deepEqual(inv, { file: 'C:\\tools\\phel.bat', args: ['test'], shell: true });
    });

    it('ignores dots in parent directories when reading the extension', () => {
        const command = 'C:\\my.projects\\ws\\vendor\\bin\\phel';
        const inv = toInvocation(command, [], { ...WIN, exists: existing(command) });
        assert.deepEqual(inv, { file: 'php', args: [command] });
    });

    it('copies the arguments rather than aliasing the caller array', () => {
        const args = ['lint'];
        const inv = toInvocation('/ws/vendor/bin/phel', args, POSIX);
        args.push('mutated');
        assert.deepEqual(inv.args, ['lint']);
    });
});

describe('coverageEnv', () => {
    it('asks Xdebug for coverage when nothing set a mode', () => {
        assert.deepEqual(coverageEnv(undefined), { XDEBUG_MODE: 'coverage' });
        assert.deepEqual(coverageEnv(''), { XDEBUG_MODE: 'coverage' });
    });

    it('overrides a mode that does not record lines', () => {
        // The default a developer keeps in php.ini; Phel then refuses the run.
        assert.deepEqual(coverageEnv('develop,debug'), { XDEBUG_MODE: 'coverage' });
        assert.deepEqual(coverageEnv('off'), { XDEBUG_MODE: 'coverage' });
    });

    it('leaves a mode that already records lines alone', () => {
        assert.equal(coverageEnv('coverage'), undefined);
        assert.equal(coverageEnv('debug,coverage'), undefined);
        assert.equal(coverageEnv('debug, coverage'), undefined);
    });
});
