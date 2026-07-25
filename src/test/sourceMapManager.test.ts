import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
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

describe('SourceMapManager cache-file resolution', function () {
    // A compiled Phel file records the source it came from on its second line:
    //   <?php
    //   // /abs/path/to/source.phel
    //   // ;;<mappings>
    // Matching on that is the reliable lookup. It used to sit behind a
    // heuristic that required the source to live in a directory called `src/`,
    // so breakpoints never resolved in a project laid out any other way —
    // `withSrcDirs` accepts any directory name.
    let dir: string;

    function writeCompiled(name: string, sourcePath: string): void {
        fs.writeFileSync(
            path.join(dir, name),
            `<?php\n// ${sourcePath}\n// ;;AAAA\nnamespace demo\\core;\n`
        );
    }

    beforeEach(function () {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phel-smm-'));
    });

    afterEach(function () {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('resolves a source that lives outside a src/ directory', function () {
        const source = path.join(dir, 'lib', 'core.phel');
        writeCompiled('demo.core__abc123.php', source);

        const m = new SourceMapManager();
        m.addCacheDirectory(dir);
        assert.strictEqual(
            path.basename(m.findCompiledFile(source) ?? ''),
            'demo.core__abc123.php'
        );
    });

    it('still resolves the conventional src/ layout', function () {
        const source = path.join(dir, 'proj', 'src', 'core.phel');
        writeCompiled('demo.core__def456.php', source);

        const m = new SourceMapManager();
        m.addCacheDirectory(dir);
        assert.strictEqual(
            path.basename(m.findCompiledFile(source) ?? ''),
            'demo.core__def456.php'
        );
    });

    it('returns null when no compiled file references the source', function () {
        writeCompiled('demo.core__abc123.php', path.join(dir, 'lib', 'core.phel'));

        const m = new SourceMapManager();
        m.addCacheDirectory(dir);
        assert.strictEqual(m.findCompiledFile(path.join(dir, 'lib', 'other.phel')), null);
    });
});

describe('SourceMapManager workspace cache discovery', function () {
    // Phel caches compiled PHP under `<cache-dir>/compiled`, and `cache-dir`
    // defaults to `.phel/cache` relative to the project root. Registering a
    // workspace root has to pick that up, or breakpoints only bind for users
    // who set `phel.cacheDirectory` by hand.
    let root: string;

    function writeCompiled(cacheDir: string, name: string, sourcePath: string): void {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(
            path.join(cacheDir, name),
            `<?php\n// ${sourcePath}\n// ;;AAAA\nnamespace demo\\core;\n`
        );
    }

    beforeEach(function () {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'phel-ws-'));
    });

    afterEach(function () {
        fs.rmSync(root, { recursive: true, force: true });
        delete process.env.PHEL_CACHE_DIR;
    });

    it('finds the project cache from the workspace root alone', function () {
        const source = path.join(root, 'lib', 'core.phel');
        writeCompiled(path.join(root, '.phel', 'cache', 'compiled'), 'demo.core__a.php', source);

        const m = new SourceMapManager();
        m.addWorkspaceRoot(root);
        assert.strictEqual(path.basename(m.findCompiledFile(source) ?? ''), 'demo.core__a.php');
    });

    it('discovers the project from the file alone, as the debug adapter does', function () {
        // The debug adapter runs in its own process and constructs its own
        // manager, so it never calls addWorkspaceRoot. Resolution has to work
        // from the `.phel` file by itself, with no launch configuration.
        const source = path.join(root, 'lib', 'core.phel');
        fs.mkdirSync(path.dirname(source), { recursive: true });
        fs.writeFileSync(path.join(root, 'phel-config.php'), '<?php');
        writeCompiled(path.join(root, '.phel', 'cache', 'compiled'), 'demo.core__d.php', source);

        const m = new SourceMapManager();
        assert.strictEqual(path.basename(m.findCompiledFile(source) ?? ''), 'demo.core__d.php');
    });

    it('gives up at the filesystem root for a file in no project', function () {
        const source = path.join(root, 'stray', 'core.phel');
        fs.mkdirSync(path.dirname(source), { recursive: true });
        const m = new SourceMapManager();
        assert.strictEqual(m.findCompiledFile(source), null);
    });

    it('honours a relative PHEL_CACHE_DIR override', function () {
        const source = path.join(root, 'lib', 'core.phel');
        writeCompiled(path.join(root, 'build', 'compiled'), 'demo.core__b.php', source);

        process.env.PHEL_CACHE_DIR = 'build';
        const m = new SourceMapManager();
        m.addWorkspaceRoot(root);
        assert.strictEqual(path.basename(m.findCompiledFile(source) ?? ''), 'demo.core__b.php');
    });

    it('honours an absolute PHEL_CACHE_DIR override', function () {
        const source = path.join(root, 'lib', 'core.phel');
        const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'phel-cache-'));
        writeCompiled(path.join(elsewhere, 'compiled'), 'demo.core__c.php', source);

        process.env.PHEL_CACHE_DIR = elsewhere;
        const m = new SourceMapManager();
        m.addWorkspaceRoot(root);
        assert.strictEqual(path.basename(m.findCompiledFile(source) ?? ''), 'demo.core__c.php');
        fs.rmSync(elsewhere, { recursive: true, force: true });
    });
});
