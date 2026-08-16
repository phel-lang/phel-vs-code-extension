import * as assert from 'node:assert/strict';
import { canonicalToWorkspace } from '../phelPaths';

const POSIX = { platform: 'linux' as NodeJS.Platform };
const WIN = { platform: 'win32' as NodeJS.Platform };

/** macOS: the workspace was opened under `/var`, the CLI answers `/private/var`. */
const MAC = {
    fsPath: '/var/folders/ab/phel-demo',
    realPath: '/private/var/folders/ab/phel-demo',
};

describe('phelPaths.canonicalToWorkspace', () => {
    it('puts the folder’s own spelling back on a path inside it', () => {
        assert.equal(
            canonicalToWorkspace('/private/var/folders/ab/phel-demo/src/app.phel', MAC, POSIX),
            '/var/folders/ab/phel-demo/src/app.phel'
        );
    });

    it('maps the folder itself', () => {
        assert.equal(canonicalToWorkspace(MAC.realPath, MAC, POSIX), MAC.fsPath);
    });

    it('leaves a path outside the folder untouched', () => {
        assert.equal(
            canonicalToWorkspace('/usr/local/share/phel/core.phel', MAC, POSIX),
            '/usr/local/share/phel/core.phel'
        );
    });

    it('does nothing when the folder is not symlinked', () => {
        const folder = { fsPath: '/home/me/demo', realPath: '/home/me/demo' };
        assert.equal(
            canonicalToWorkspace('/home/me/demo/src/app.phel', folder, POSIX),
            '/home/me/demo/src/app.phel'
        );
    });

    it('tolerates a trailing separator on either spelling', () => {
        const folder = { fsPath: `${MAC.fsPath}/`, realPath: `${MAC.realPath}/` };
        assert.equal(
            canonicalToWorkspace('/private/var/folders/ab/phel-demo/src/app.phel', folder, POSIX),
            '/var/folders/ab/phel-demo/src/app.phel'
        );
    });

    it('only matches at a path boundary', () => {
        // `phel-demo2` merely starts with the folder path; it is not in it.
        assert.equal(
            canonicalToWorkspace('/private/var/folders/ab/phel-demo2/src/app.phel', MAC, POSIX),
            '/private/var/folders/ab/phel-demo2/src/app.phel'
        );
    });

    it('is case-insensitive on Windows only', () => {
        const folder = { fsPath: 'C:\\Users\\me\\demo', realPath: 'D:\\Real\\demo' };
        assert.equal(
            canonicalToWorkspace('d:\\real\\demo\\src\\app.phel', folder, WIN),
            'C:\\Users\\me\\demo\\src\\app.phel'
        );
        assert.equal(
            canonicalToWorkspace('d:\\real\\demo\\src\\app.phel', folder, POSIX),
            'd:\\real\\demo\\src\\app.phel'
        );
    });

    it('reads a Windows path spelled with forward slashes', () => {
        const folder = { fsPath: 'C:\\Users\\me\\demo', realPath: 'D:\\Real\\demo' };
        assert.equal(
            canonicalToWorkspace('D:/Real/demo/src/app.phel', folder, WIN),
            'C:\\Users\\me\\demo/src/app.phel'
        );
    });

    it('leaves an empty path alone', () => {
        assert.equal(canonicalToWorkspace('', MAC, POSIX), '');
    });
});
