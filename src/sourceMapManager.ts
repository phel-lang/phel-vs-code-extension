import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PhelSourceMap, extractSourceMapFromFile } from './sourceMap';

/**
 * Manages source maps for Phel files.
 * Handles:
 * - Finding compiled PHP files for Phel sources
 * - Loading and caching source maps
 * - Bidirectional file/line lookups
 */
export class SourceMapManager {
    // Cache: phelFile -> PhelSourceMap
    private sourceMapsByPhelFile: Map<string, PhelSourceMap> = new Map();
    // Cache: phpFile -> PhelSourceMap
    private sourceMapsByPhpFile: Map<string, PhelSourceMap> = new Map();
    // Cache: phelFile -> phpFile
    private phelToPhpPath: Map<string, string> = new Map();
    // Cache: phpFile -> phelFile
    private phpToPhelPath: Map<string, string> = new Map();

    private cacheDirectories: string[] = [];
    private workspaceRoots: string[] = [];

    constructor() {
        // Default Phel cache directory - resolve symlinks (macOS /var -> /private/var)
        this.cacheDirectories.push(
            this.normalizePath(path.join(os.tmpdir(), 'phel', 'cache', 'compiled'))
        );
    }

    /**
     * Normalize a file path by resolving symlinks.
     * This is critical on macOS where /var is a symlink to /private/var.
     * Without this, Xdebug breakpoints may not match due to path mismatch.
     */
    private normalizePath(filePath: string): string {
        try {
            return fs.realpathSync(filePath);
        } catch {
            // If file doesn't exist yet, just normalize the path
            return path.normalize(filePath);
        }
    }

    /**
     * Add a workspace root for searching.
     */
    addWorkspaceRoot(root: string): void {
        if (!this.workspaceRoots.includes(root)) {
            this.workspaceRoots.push(root);
        }

        // Phel caches compiled PHP under `<cache-dir>/compiled`, and its
        // `cache-dir` defaults to `.phel/cache` *relative to the project root*
        // (`PhelConfig::DEFAULT_CACHE_DIR`), overridable with `PHEL_CACHE_DIR`.
        // Registering it here is what makes breakpoints bind without the user
        // having to point `phel.cacheDirectory` at it by hand.
        const envCacheDir = process.env.PHEL_CACHE_DIR;
        const cacheRoot = envCacheDir
            ? path.isAbsolute(envCacheDir)
                ? envCacheDir
                : path.join(root, envCacheDir)
            : path.join(root, '.phel', 'cache');
        this.addCacheDirectory(path.join(cacheRoot, 'compiled'));
    }

    /**
     * Add a cache directory to search for compiled files.
     */
    addCacheDirectory(dir: string): void {
        const normalizedDir = this.normalizePath(dir);
        if (normalizedDir && !this.cacheDirectories.includes(normalizedDir)) {
            this.cacheDirectories.push(normalizedDir);
        }
    }

    /**
     * Clear all cached source maps.
     */
    clearCache(): void {
        this.sourceMapsByPhelFile.clear();
        this.sourceMapsByPhpFile.clear();
        this.phelToPhpPath.clear();
        this.phpToPhelPath.clear();
    }

    /**
     * Convert a Phel namespace to the expected compiled filename.
     * Example: "web-skeleton\controller\routes" -> "web-skeleton_controller_routes.php"
     */
    private namespaceToFilename(namespace: string): string {
        return namespace.replace(/[\\/]/g, '_') + '.php';
    }

    /**
     * Extract the namespace from a Phel file path.
     * Example: "/path/to/project/src/controller/routes.phel" -> "web-skeleton\controller\routes"
     *
     * This is a heuristic based on common project structures.
     */
    private extractNamespaceFromPath(phelFile: string): string | null {
        const normalizedPath = phelFile.replace(/\\/g, '/');

        // Try to find src/ directory as namespace root
        const srcMatch = normalizedPath.match(/\/([^/]+)\/src\/(.+)\.phel$/);
        if (srcMatch) {
            const projectName = srcMatch[1];
            const relativePath = srcMatch[2];
            return `${projectName}\\${relativePath.replace(/\//g, '\\')}`;
        }

        return null;
    }

    /**
     * Walk up from a `.phel` file to its project root — the nearest ancestor
     * holding a `phel-config.php` or a `.phel/` directory — and register that
     * project's compiled-cache directory.
     *
     * Cheap and idempotent: `addCacheDirectory` de-duplicates, and the walk
     * stops at the filesystem root.
     */
    private registerProjectCacheFor(phelFile: string): void {
        let dir = path.dirname(phelFile);
        for (;;) {
            const hasConfig = fs.existsSync(path.join(dir, 'phel-config.php'));
            const hasCache = fs.existsSync(path.join(dir, '.phel'));
            if (hasConfig || hasCache) {
                this.addWorkspaceRoot(dir);
                return;
            }
            const parent = path.dirname(dir);
            if (parent === dir) {
                return; // filesystem root
            }
            dir = parent;
        }
    }

    /**
     * Find the compiled PHP file for a Phel source file.
     */
    findCompiledFile(phelFile: string): string | null {
        const normalizedPhelFile = this.normalizePath(phelFile);

        // Check cache first
        if (this.phelToPhpPath.has(normalizedPhelFile)) {
            return this.phelToPhpPath.get(normalizedPhelFile) || null;
        }

        // The debug adapter runs in its own process and builds its own manager,
        // so it never sees `addWorkspaceRoot`. Locate the project from the file
        // being debugged instead, which needs no launch configuration at all.
        this.registerProjectCacheFor(normalizedPhelFile);

        // Fast path: guess the compiled filename from the namespace. Only some
        // project layouts yield a namespace, and the guess only matches some
        // cache naming schemes, so a miss here is expected rather than fatal —
        // the content scan below is the reliable answer.
        const namespace = this.extractNamespaceFromPath(normalizedPhelFile);
        if (namespace) {
            const expectedFilename = this.namespaceToFilename(namespace);

            for (const cacheDir of this.cacheDirectories) {
                const phpFile = path.join(cacheDir, expectedFilename);
                if (fs.existsSync(phpFile)) {
                    const normalizedPhpFile = this.normalizePath(phpFile);
                    this.phelToPhpPath.set(normalizedPhelFile, normalizedPhpFile);
                    this.phpToPhelPath.set(normalizedPhpFile, normalizedPhelFile);
                    return normalizedPhpFile;
                }
            }
        }

        // Reliable path: every compiled file records the source it came from on
        // its second line, so match on that. This has to run even when the
        // namespace heuristic found nothing — `withSrcDirs` accepts any
        // directory name, and bailing out early left breakpoints unresolved in
        // every project that does not keep its sources in `src/`.
        for (const cacheDir of this.cacheDirectories) {
            if (!fs.existsSync(cacheDir)) {
                continue;
            }

            try {
                const files = fs.readdirSync(cacheDir);
                for (const file of files) {
                    if (!file.endsWith('.php')) {
                        continue;
                    }

                    const phpFile = path.join(cacheDir, file);
                    const content = fs.readFileSync(phpFile, 'utf-8');
                    const info = extractSourceMapFromFile(content);

                    if (info && this.pathsMatch(info.originalFile, normalizedPhelFile)) {
                        const normalizedPhpFile = this.normalizePath(phpFile);
                        this.phelToPhpPath.set(normalizedPhelFile, normalizedPhpFile);
                        this.phpToPhelPath.set(normalizedPhpFile, normalizedPhelFile);
                        return normalizedPhpFile;
                    }
                }
            } catch {
                // Ignore errors reading cache directory
            }
        }

        return null;
    }

    /**
     * Find the original Phel file for a compiled PHP file.
     */
    findOriginalFile(phpFile: string): string | null {
        const normalizedPhpFile = this.normalizePath(phpFile);

        // Check cache first
        if (this.phpToPhelPath.has(normalizedPhpFile)) {
            return this.phpToPhelPath.get(normalizedPhpFile) || null;
        }

        // Read the PHP file and extract the source map header
        try {
            const content = fs.readFileSync(normalizedPhpFile, 'utf-8');
            const info = extractSourceMapFromFile(content);

            if (info && info.originalFile) {
                const normalizedPhelFile = this.normalizePath(info.originalFile);
                this.phpToPhelPath.set(normalizedPhpFile, normalizedPhelFile);
                this.phelToPhpPath.set(normalizedPhelFile, normalizedPhpFile);
                return normalizedPhelFile;
            }
        } catch {
            // Ignore read errors
        }

        return null;
    }

    /**
     * Check if two paths refer to the same file by resolving symlinks.
     */
    private pathsMatch(path1: string, path2: string): boolean {
        const normalized1 = this.normalizePath(path1).toLowerCase();
        const normalized2 = this.normalizePath(path2).toLowerCase();
        return normalized1 === normalized2;
    }

    /**
     * Load source map for a Phel file.
     */
    loadSourceMapForPhelFile(phelFile: string): PhelSourceMap | null {
        const normalizedPhelFile = this.normalizePath(phelFile);

        // Check cache
        if (this.sourceMapsByPhelFile.has(normalizedPhelFile)) {
            return this.sourceMapsByPhelFile.get(normalizedPhelFile) || null;
        }

        // Find the compiled PHP file
        const phpFile = this.findCompiledFile(normalizedPhelFile);
        if (!phpFile) {
            return null;
        }

        return this.loadSourceMapFromPhpFile(phpFile, normalizedPhelFile);
    }

    /**
     * Load source map for a compiled PHP file.
     */
    loadSourceMapForPhpFile(phpFile: string): PhelSourceMap | null {
        const normalizedPhpFile = this.normalizePath(phpFile);

        // Check cache
        if (this.sourceMapsByPhpFile.has(normalizedPhpFile)) {
            return this.sourceMapsByPhpFile.get(normalizedPhpFile) || null;
        }

        // Find the original Phel file
        const phelFile = this.findOriginalFile(normalizedPhpFile);
        if (!phelFile) {
            return null;
        }

        return this.loadSourceMapFromPhpFile(normalizedPhpFile, phelFile);
    }

    /**
     * Load source map from a PHP file.
     */
    private loadSourceMapFromPhpFile(phpFile: string, phelFile: string): PhelSourceMap | null {
        // Both paths should already be normalized by callers
        try {
            // Read PHP file content
            const phpContent = fs.readFileSync(phpFile, 'utf-8');

            // Try reading from separate .map file first
            const mapFile = phpFile + '.map';
            let sourceMapString: string | null = null;

            if (fs.existsSync(mapFile)) {
                sourceMapString = fs.readFileSync(mapFile, 'utf-8').trim();
            } else {
                // Extract from PHP file header
                const info = extractSourceMapFromFile(phpContent);
                if (info) {
                    sourceMapString = info.sourceMap;
                }
            }

            if (!sourceMapString) {
                return null;
            }

            // Pass PHP content for smart breakpoint line selection
            const sourceMap = new PhelSourceMap(sourceMapString, phelFile, phpFile, phpContent);

            // Cache both ways
            this.sourceMapsByPhelFile.set(phelFile, sourceMap);
            this.sourceMapsByPhpFile.set(phpFile, sourceMap);

            return sourceMap;
        } catch (e) {
            console.error(`Failed to load source map for ${phpFile}:`, e);
            return null;
        }
    }

    /**
     * Get breakpoint candidate lines for a Phel file/line.
     * Returns multiple PHP lines that could be valid breakpoint locations.
     */
    getBreakpointCandidates(
        phelFile: string,
        phelLine: number
    ): { file: string; lines: number[] } | null {
        const sourceMap = this.loadSourceMapForPhelFile(phelFile);
        if (!sourceMap) {
            return null;
        }

        const candidates = sourceMap.getBreakpointCandidates(phelLine);
        if (candidates.length === 0) {
            return null;
        }

        return {
            file: sourceMap.getGeneratedFile(),
            lines: candidates,
        };
    }

    /**
     * Translate a Phel file/line to PHP file/line.
     */
    translateToPhp(phelFile: string, phelLine: number): { file: string; line: number } | null {
        const sourceMap = this.loadSourceMapForPhelFile(phelFile);
        if (!sourceMap) {
            return null;
        }

        const phpLine = sourceMap.getGeneratedLine(phelLine);
        if (phpLine === null) {
            return null;
        }

        return {
            file: sourceMap.getGeneratedFile(),
            line: phpLine,
        };
    }

    /**
     * Translate a Phel file/line/column to PHP file/line.
     * Column-aware: uses column information to find the exact expression.
     */
    translateToPhpWithColumn(
        phelFile: string,
        phelLine: number,
        phelColumn: number
    ): { file: string; line: number } | null {
        const sourceMap = this.loadSourceMapForPhelFile(phelFile);
        if (!sourceMap) {
            return null;
        }

        const phpLine = sourceMap.getGeneratedLineAtColumn(phelLine, phelColumn);
        if (phpLine === null) {
            return null;
        }

        return {
            file: sourceMap.getGeneratedFile(),
            line: phpLine,
        };
    }

    /**
     * Translate a PHP file/line to Phel file/line.
     */
    translateToPhel(phpFile: string, phpLine: number): { file: string; line: number } | null {
        const sourceMap = this.loadSourceMapForPhpFile(phpFile);
        if (!sourceMap) {
            return null;
        }

        const phelLine = sourceMap.getOriginalLine(phpLine);
        if (phelLine === null) {
            return null;
        }

        return {
            file: sourceMap.getOriginalFile(),
            line: phelLine,
        };
    }

    /**
     * Check if a file is a Phel source file.
     */
    isPhelFile(filePath: string): boolean {
        return filePath.endsWith('.phel');
    }

    /**
     * Check if a file is a compiled Phel PHP file (has source map).
     */
    isCompiledPhelFile(filePath: string): boolean {
        if (!filePath.endsWith('.php')) {
            return false;
        }

        const normalizedPath = this.normalizePath(filePath);

        // Check if it's in a known cache directory
        for (const cacheDir of this.cacheDirectories) {
            if (normalizedPath.startsWith(cacheDir)) {
                return true;
            }
        }

        // Check if the file has a source map header
        try {
            const content = fs.readFileSync(normalizedPath, 'utf-8');
            return extractSourceMapFromFile(content) !== null;
        } catch {
            return false;
        }
    }
}
