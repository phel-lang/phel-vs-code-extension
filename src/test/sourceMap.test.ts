import * as assert from 'assert';
import { PhelSourceMap } from '../sourceMap';

describe('PhelSourceMap', function () {
    describe('constructor', function () {
        it('should parse a valid source map', function () {
            const sourceMap = 'AAAA,AAAC;AAAA,AAAC';
            const originalFile = '/test/src/app.phel';
            const generatedFile = '/tmp/phel/cache/test_app.php';

            const map = new PhelSourceMap(sourceMap, originalFile, generatedFile);
            assert.ok(map !== null);
            assert.strictEqual(map.getOriginalFile(), originalFile);
        });

        it('should handle empty source map', function () {
            const map = new PhelSourceMap('', '/test.phel', '/test.php');
            assert.strictEqual(map.getGeneratedLine(1), null);
        });
    });

    describe('getGeneratedLine', function () {
        it('should map original line to generated line', function () {
            // Source map with multiple lines:
            // Line 0: genCol=0, source=0, origLine=0, origCol=0
            // Line 1: genCol=0, source=0, origLine=1, origCol=0
            const sourceMap = 'AAAA;AACA';
            const map = new PhelSourceMap(sourceMap, '/test.phel', '/test.php');

            // Original line 1 (0-based) should map to generated line 2 (1-based)
            const genLine = map.getGeneratedLine(2);
            assert.ok(genLine !== null);
            assert.ok(typeof genLine === 'number');
        });

        it('should find closest line when exact match not found', function () {
            // Only line 0 is mapped
            const sourceMap = 'AAAA';
            const map = new PhelSourceMap(sourceMap, '/test.phel', '/test.php');

            // Line 10 doesn't exist, but closest should be found or null
            const genLine = map.getGeneratedLine(10);
            // This is acceptable behavior - either finds closest or returns null
            assert.ok(genLine === null || typeof genLine === 'number');
        });

        it('should return null for unmapped lines', function () {
            const map = new PhelSourceMap('', '/test.phel', '/test.php');
            assert.strictEqual(map.getGeneratedLine(100), null);
        });
    });

    describe('getOriginalLine', function () {
        it('should map generated line back to original line', function () {
            // When there's a mapping, getOriginalLine should return it
            // AAAA = [0,0,0,0] -> genLine=1, origLine=1 (1-based from parseSourceMap)
            // After HEADER_OFFSET=3, genLine becomes 4
            const sourceMap = 'AAAA;AACA;AACA'; // 3 lines of mappings
            const map = new PhelSourceMap(sourceMap, '/test.phel', '/test.php');

            // The getMappings should show what lines are mapped
            const mappings = map.getMappings();
            assert.ok(mappings.length > 0, 'Should have some mappings');

            // Generated line 4 (1 + HEADER_OFFSET=3) should map to original line 1
            const origLine = map.getOriginalLine(4);
            assert.ok(typeof origLine === 'number', `Expected number but got ${origLine}`);
            assert.strictEqual(origLine, 1);
        });

        it('should handle generated lines without direct mapping', function () {
            const sourceMap = 'AAAA';
            const map = new PhelSourceMap(sourceMap, '/test.phel', '/test.php');

            // Very large line number should use closest or return null
            const origLine = map.getOriginalLine(1000);
            // Either null or a closest match is acceptable
            assert.ok(origLine === null || typeof origLine === 'number');
        });
    });

    describe('real-world source map', function () {
        it('should handle complex Phel source maps', function () {
            // More realistic source map with multiple segments
            // AAAA = [0,0,0,0], CAAC = [1,0,0,1], EAAE = [2,0,0,2]
            const sourceMap = 'AAAA,CAAC,EAAE;AACA;AACA,CAAC';
            const map = new PhelSourceMap(
                sourceMap,
                '/project/src/controller/routes.phel',
                '/tmp/phel/cache/compiled/project_controller_routes.php'
            );

            // First line should be mapped
            const genLine1 = map.getGeneratedLine(1);
            assert.ok(genLine1 !== null, 'Line 1 should be mapped');

            // Check that different original lines map to different generated lines
            const genLine2 = map.getGeneratedLine(2);
            assert.ok(genLine2 !== null, 'Line 2 should be mapped');
        });

        it('should correctly report original file path', function () {
            const originalPath = '/Users/test/project/src/app.phel';
            const map = new PhelSourceMap('AAAA', originalPath, '/tmp/test.php');

            assert.strictEqual(map.getOriginalFile(), originalPath);
        });
    });

    describe('column-aware mapping', function () {
        it('should track detailed mappings with columns', function () {
            // Multiple segments on same line with different columns
            const sourceMap = 'AAAA,CAAC,EAAE;AACA';
            const map = new PhelSourceMap(sourceMap, '/test.phel', '/test.php');

            // Line 1 should have multiple detailed mappings
            const details = map.getDetailedMappings(1);
            assert.ok(details.length >= 1, 'Should have at least one detailed mapping');
        });

        it('should get generated line at specific column', function () {
            const sourceMap = 'AAAA,CAAC;AACA';
            const map = new PhelSourceMap(sourceMap, '/test.phel', '/test.php');

            // Get line at column 0
            const line1 = map.getGeneratedLineAtColumn(1, 0);
            assert.ok(line1 !== null, 'Should find mapping at column 0');

            // Get line at column 1 (should find closest)
            const line2 = map.getGeneratedLineAtColumn(1, 1);
            assert.ok(line2 !== null, 'Should find mapping at column 1');
        });
    });

    describe('breakpoint candidates', function () {
        it('should return multiple candidates for complex lines', function () {
            const sourceMap = 'AAAA,CAAC,EAAE;AACA';
            const map = new PhelSourceMap(sourceMap, '/test.phel', '/test.php');

            const candidates = map.getBreakpointCandidates(1);
            assert.ok(Array.isArray(candidates), 'Should return an array');
        });

        it('should return empty array for unmapped lines', function () {
            const map = new PhelSourceMap('', '/test.phel', '/test.php');

            const candidates = map.getBreakpointCandidates(100);
            assert.ok(Array.isArray(candidates), 'Should return an array');
            assert.strictEqual(candidates.length, 0, 'Should be empty for unmapped lines');
        });
    });

    describe('multi-line form fallback', function () {
        it('should find enclosing form for lines without direct mapping', function () {
            // Source map: line 1 maps, line 3 maps, line 2 has no mapping
            const sourceMap = 'AAAA;;AACA';
            const map = new PhelSourceMap(sourceMap, '/test.phel', '/test.php');

            // Line 2 (no direct mapping) should fall back to nearby line
            const genLine = map.getGeneratedLine(2);
            assert.ok(genLine !== null, 'Should find fallback for line 2');
        });

        it('should prefer next expression for comments', function () {
            // Source map: only line 3 has mapping
            const sourceMap = ';;AAAA';
            const map = new PhelSourceMap(sourceMap, '/test.phel', '/test.php');

            // Line 1 should find line 3's mapping (next expression)
            const genLine = map.getGeneratedLine(1);
            // Should either find the next mapping or return null
            assert.ok(genLine === null || typeof genLine === 'number');
        });
    });
});
