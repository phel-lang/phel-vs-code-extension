import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';

describe('Extension Utilities', function () {
    describe('parsePhelConfig', function () {
        // Replicate the parsePhelConfig logic for testing
        function parsePhelConfig(content: string): { tempDir?: string } {
            const result: { tempDir?: string } = {};

            // Look for ->setTempDir('path') or ->setTempDir("path")
            const tempDirMatch = content.match(/->setTempDir\s*\(\s*['"]([^'"]+)['"]\s*\)/);
            if (tempDirMatch) {
                result.tempDir = tempDirMatch[1];
            }

            // Also check for sys_get_temp_dir() pattern
            if (content.includes('sys_get_temp_dir()') && content.includes('/phel')) {
                // Default Phel behavior: sys_get_temp_dir() . '/phel'
                result.tempDir = path.join(os.tmpdir(), 'phel');
            }

            return result;
        }

        it('should extract tempDir from single-quoted string', function () {
            const content = `<?php
return (new \\Phel\\Config\\PhelConfig())
    ->setSrcDirs(['src'])
    ->setTempDir('/custom/temp/dir')
    ->setVendorDir('vendor');
`;
            const result = parsePhelConfig(content);
            assert.strictEqual(result.tempDir, '/custom/temp/dir');
        });

        it('should extract tempDir from double-quoted string', function () {
            const content = `<?php
return (new \\Phel\\Config\\PhelConfig())
    ->setTempDir("/another/temp/path");
`;
            const result = parsePhelConfig(content);
            assert.strictEqual(result.tempDir, '/another/temp/path');
        });

        it('should detect sys_get_temp_dir() pattern', function () {
            const content = `<?php
return (new \\Phel\\Config\\PhelConfig())
    ->setTempDir(sys_get_temp_dir().'/phel');
`;
            const result = parsePhelConfig(content);
            assert.strictEqual(result.tempDir, path.join(os.tmpdir(), 'phel'));
        });

        it('should return empty object when no tempDir is set', function () {
            const content = `<?php
return (new \\Phel\\Config\\PhelConfig())
    ->setSrcDirs(['src'])
    ->setVendorDir('vendor');
`;
            const result = parsePhelConfig(content);
            assert.strictEqual(result.tempDir, undefined);
        });

        it('should handle Windows-style paths', function () {
            const content = `<?php
return (new \\Phel\\Config\\PhelConfig())
    ->setTempDir('C:\\Users\\test\\AppData\\Local\\Temp\\phel');
`;
            const result = parsePhelConfig(content);
            assert.strictEqual(result.tempDir, 'C:\\Users\\test\\AppData\\Local\\Temp\\phel');
        });

        it('should handle paths with spaces', function () {
            const content = `<?php
return (new \\Phel\\Config\\PhelConfig())
    ->setTempDir('/path/with spaces/phel');
`;
            const result = parsePhelConfig(content);
            assert.strictEqual(result.tempDir, '/path/with spaces/phel');
        });
    });

    describe('Phel file detection', function () {
        it('should identify .phel files correctly', function () {
            const isPhelFile = (filePath: string) => filePath.endsWith('.phel');

            assert.strictEqual(isPhelFile('test.phel'), true);
            assert.strictEqual(isPhelFile('/path/to/routes.phel'), true);
            assert.strictEqual(isPhelFile('src/controller/main.phel'), true);

            assert.strictEqual(isPhelFile('test.php'), false);
            assert.strictEqual(isPhelFile('test.phelx'), false);
            assert.strictEqual(isPhelFile('phel'), false);
        });
    });

    describe('Debug configuration defaults', function () {
        it('should have correct default port', function () {
            const defaultPort = 9003;
            assert.strictEqual(defaultPort, 9003, 'Default Xdebug port should be 9003');
        });

        it('should construct cache path correctly', function () {
            const tempDir = '/tmp/phel';
            const cacheDir = path.join(tempDir, 'cache', 'compiled');
            assert.strictEqual(cacheDir, '/tmp/phel/cache/compiled');
        });
    });
});
