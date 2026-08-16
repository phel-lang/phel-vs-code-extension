// The effective Phel configuration of a project, as `phel config --format=json`
// prints it.
//
// `phel-config.php` is PHP: it can compute its values, and Phel merges
// `phel-config-local.php` over it before applying the defaults. The CLI is
// therefore the only reader that gets the answer right, and this module only
// has to make sense of what it printed — tolerantly, since a deprecation
// notice or a Composer banner ahead of the JSON is common enough.
//
// Kept free of `vscode` imports so both halves are unit-testable; the editor
// wiring (spawning, watching, invalidation) lives in
// `phelProjectConfigProvider.ts`.

/**
 * The subset of `phel config` the extension acts on. A key the CLI did not
 * print (an older Phel, a trimmed build) reads as empty rather than as a
 * guessed default, so a consumer can tell "unknown" from "configured" and keep
 * its own fallback.
 */
export interface PhelProjectConfig {
    /** `src-dirs`, relative to the project root. */
    srcDirs: string[];
    /** `test-dirs`, relative to the project root. */
    testDirs: string[];
    /** `vendor-dir`, where Composer installed the dependencies. */
    vendorDir: string;
    /** `temp-dir`, absolute on every Phel that prints it. */
    tempDir: string;
    /** `cache-dir`; Phel writes compiled PHP under `<cache-dir>/compiled`. */
    cacheDir: string;
    /** `warn-deprecations`: whether the compiler reports deprecated calls. */
    warnDeprecations: boolean;
    /** `format-dirs`, what `phel format` walks when given no paths. */
    formatDirs: string[];
}

/**
 * Parse the stdout of `phel config --format=json`. Returns `null` when nothing
 * in it is a JSON object, which is how a missing or too-old CLI is reported.
 */
export function parsePhelConfigJson(stdout: string): PhelProjectConfig | null {
    const parsed = parseJsonLoose(stdout);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
    }
    const record = parsed as Record<string, unknown>;
    return {
        srcDirs: stringArray(record['src-dirs']),
        testDirs: stringArray(record['test-dirs']),
        vendorDir: stringValue(record['vendor-dir']),
        tempDir: stringValue(record['temp-dir']),
        cacheDir: stringValue(record['cache-dir']),
        warnDeprecations: record['warn-deprecations'] === true,
        formatDirs: stringArray(record['format-dirs']),
    };
}

/**
 * `JSON.parse`, retried over the outermost `{…}` when the CLI printed
 * something around it (a warning on an older Phel, a PHP notice). `null` when
 * neither attempt parses.
 */
export function parseJsonLoose(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start < 0 || end <= start) {
            return null;
        }
        try {
            return JSON.parse(raw.slice(start, end + 1));
        } catch {
            return null;
        }
    }
}

function stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/**
 * Per-key cache of a loaded configuration and of the load still in flight, so
 * the several features that ask during the same PHP boot share one subprocess
 * instead of starting one each.
 *
 * Listeners hear about both halves of a change: `invalidate` (a config file was
 * saved) and the load that answers the next `get`. A consumer that renders from
 * `peek` therefore gets one refresh when the answer arrives, without polling.
 */
export class ProjectConfigCache<K> {
    private readonly values = new Map<K, PhelProjectConfig | null>();
    private readonly inFlight = new Map<K, Promise<PhelProjectConfig | null>>();
    /** Bumped on every invalidation, so a load in flight knows it went stale. */
    private readonly generations = new Map<K, number>();
    private readonly listeners: ((key: K) => void)[] = [];

    constructor(private readonly loader: (key: K) => Promise<PhelProjectConfig | null>) {}

    /** The cached value, or `undefined` while it has never finished loading. */
    peek(key: K): PhelProjectConfig | null | undefined {
        return this.values.get(key);
    }

    get(key: K): Promise<PhelProjectConfig | null> {
        if (this.values.has(key)) {
            return Promise.resolve(this.values.get(key) ?? null);
        }
        const pending = this.inFlight.get(key);
        if (pending) {
            return pending;
        }
        const generation = this.generations.get(key) ?? 0;
        const load = this.loader(key)
            .catch(() => null)
            .then((value) => {
                if ((this.generations.get(key) ?? 0) !== generation) {
                    // Invalidated while the CLI was running: hand this caller
                    // the answer it waited for, but do not cache a stale one.
                    return value;
                }
                this.inFlight.delete(key);
                this.values.set(key, value);
                this.notify(key);
                return value;
            });
        this.inFlight.set(key, load);
        return load;
    }

    /** Forget `key` and tell listeners, so they ask again. */
    invalidate(key: K): void {
        const known = this.values.delete(key);
        const loading = this.inFlight.delete(key);
        this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
        if (known || loading) {
            this.notify(key);
        }
    }

    invalidateAll(): void {
        for (const key of new Set([...this.values.keys(), ...this.inFlight.keys()])) {
            this.invalidate(key);
        }
    }

    /** Subscribe to invalidations and completed loads; returns an unsubscribe. */
    onDidChange(listener: (key: K) => void): () => void {
        this.listeners.push(listener);
        return () => {
            const at = this.listeners.indexOf(listener);
            if (at >= 0) {
                this.listeners.splice(at, 1);
            }
        };
    }

    private notify(key: K): void {
        for (const listener of [...this.listeners]) {
            listener(key);
        }
    }
}
