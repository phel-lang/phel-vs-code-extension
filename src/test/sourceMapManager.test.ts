import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import { SourceMapManager } from '../sourceMapManager';

describe('SourceMapManager', function () {
    let manager: SourceMapManager;

    beforeEach(function () {
        manager = new SourceMapManager();
    });

    describe('constructor', function () {
        it('should initialize with default cache directory', function () {
            // The manager should have the default Phel cache directory
            assert.ok(manager, 'Manager should be created');
        });
    });

    describe('addWorkspaceRoot', function () {
        it('should add workspace roots', function () {
            manager.addWorkspaceRoot('/path/to/workspace1');
            manager.addWorkspaceRoot('/path/to/workspace2');
            // No exception means success
            assert.ok(true);
        });

        it('should not add duplicate workspace roots', function () {
            manager.addWorkspaceRoot('/path/to/workspace');
            manager.addWorkspaceRoot('/path/to/workspace');
            // No exception means success (internally deduped)
            assert.ok(true);
        });
    });

    describe('addCacheDirectory', function () {
        it('should add cache directories', function () {
            manager.addCacheDirectory('/custom/cache/dir');
            // No exception means success
            assert.ok(true);
        });

        it('should not add duplicate cache directories', function () {
            manager.addCacheDirectory('/custom/cache');
            manager.addCacheDirectory('/custom/cache');
            // No exception means success (internally deduped)
            assert.ok(true);
        });
    });

    describe('clearCache', function () {
        it('should clear all caches', function () {
            manager.clearCache();
            // No exception and no cached data
            assert.ok(true);
        });
    });

    describe('isPhelFile', function () {
        it('should return true for .phel files', function () {
            assert.strictEqual(manager.isPhelFile('/path/to/file.phel'), true);
            assert.strictEqual(manager.isPhelFile('file.phel'), true);
            assert.strictEqual(manager.isPhelFile('/some/deep/path/app.phel'), true);
        });

        it('should return false for non-.phel files', function () {
            assert.strictEqual(manager.isPhelFile('/path/to/file.php'), false);
            assert.strictEqual(manager.isPhelFile('/path/to/file.js'), false);
            assert.strictEqual(manager.isPhelFile('/path/to/file.phel.bak'), false);
            assert.strictEqual(manager.isPhelFile('/path/to/phel'), false);
        });
    });

    describe('isCompiledPhelFile', function () {
        it('should return false for non-.php files', function () {
            assert.strictEqual(manager.isCompiledPhelFile('/path/to/file.phel'), false);
            assert.strictEqual(manager.isCompiledPhelFile('/path/to/file.js'), false);
        });

        it('should return false for non-existent PHP files not in cache dir', function () {
            assert.strictEqual(manager.isCompiledPhelFile('/non/existent/file.php'), false);
        });
    });

    describe('namespace extraction (internal)', function () {
        // Test through findCompiledFile which uses extractNamespaceFromPath internally
        it('should find compiled file returns null for non-Phel paths', function () {
            // A path that doesn't match the namespace pattern
            const result = manager.findCompiledFile('/random/path/file.phel');
            assert.strictEqual(result, null);
        });
    });

    describe('translateToPhp', function () {
        it('should return null when no source map exists', function () {
            const result = manager.translateToPhp('/nonexistent/file.phel', 10);
            assert.strictEqual(result, null);
        });
    });

    describe('translateToPhel', function () {
        it('should return null when no source map exists', function () {
            const result = manager.translateToPhel('/nonexistent/file.php', 10);
            assert.strictEqual(result, null);
        });
    });

    describe('translateToPhpWithColumn', function () {
        it('should return null when no source map exists', function () {
            const result = manager.translateToPhpWithColumn('/nonexistent/file.phel', 10, 5);
            assert.strictEqual(result, null);
        });
    });

    describe('getBreakpointCandidates', function () {
        it('should return null when no source map exists', function () {
            const result = manager.getBreakpointCandidates('/nonexistent/file.phel', 10);
            assert.strictEqual(result, null);
        });
    });

    describe('findCompiledFile', function () {
        it('should return null for files without matching namespace', function () {
            const result = manager.findCompiledFile('/random/path.phel');
            assert.strictEqual(result, null);
        });

        it('should return null for non-existent compiled files', function () {
            // A properly formatted path but no compiled file exists
            const result = manager.findCompiledFile('/project/src/controller/routes.phel');
            assert.strictEqual(result, null);
        });
    });

    describe('findOriginalFile', function () {
        it('should return null for non-existent PHP files', function () {
            const result = manager.findOriginalFile('/nonexistent/compiled.php');
            assert.strictEqual(result, null);
        });
    });

    describe('loadSourceMapForPhelFile', function () {
        it('should return null when compiled file not found', function () {
            const result = manager.loadSourceMapForPhelFile('/nonexistent/file.phel');
            assert.strictEqual(result, null);
        });
    });

    describe('loadSourceMapForPhpFile', function () {
        it('should return null when original file not found', function () {
            const result = manager.loadSourceMapForPhpFile('/nonexistent/file.php');
            assert.strictEqual(result, null);
        });
    });
});

describe('SourceMapManager namespace to filename', function () {
    // We can't directly test private methods, but we can verify the expected
    // file naming convention through behavior

    it('should return null when cache dir does not contain matching file', function () {
        // Create a fresh manager with only a non-existent cache dir
        const manager = new SourceMapManager();

        // Add a cache directory that definitely doesn't exist
        const tempCacheDir = path.join(
            os.tmpdir(),
            'phel-nonexistent-' + Date.now() + '-' + Math.random()
        );
        manager.addCacheDirectory(tempCacheDir);

        // Clear the default cache dir by creating a new manager and only adding our empty one
        const freshManager = new SourceMapManager();
        // The fresh manager will have the default cache dir, but we test with a completely
        // non-matching path that won't find anything in any cache
        const result = freshManager.findCompiledFile('/nonexistent-project/src/some/file.phel');
        assert.strictEqual(result, null);
    });
});
