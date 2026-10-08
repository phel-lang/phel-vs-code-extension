// Which column base a Phel reports diagnostics in. Phel 0.54.0 and older print
// 0-based columns from `phel lint --format=json`, `phel analyze` and the
// api-daemon's `analyzeSource`; every release after it prints 1-based ones
// (phel-lang/phel-lang#3625). Lines were always 1-based.
//
// Kept free of `vscode` imports so unit tests can exercise it directly.

export type ColumnBase = 0 | 1;

/** The last release that reports 0-based columns. */
const LAST_ZERO_BASED: readonly [number, number, number] = [0, 54, 0];

/**
 * The column base of the Phel that printed `version`, as `phel --version` or
 * the daemon's `version` method spell it (`Phel v0.54.0`, `v1.0.0-rc3`,
 * `v0.54.0-beta#beda2be`). `undefined` when no version can be read from it.
 *
 * A suffixed build of 0.54.0 counts as newer: a dev build prints the last tag
 * plus `-beta#<sha>`, so `v0.54.0-beta#…` is a commit after the 0.54.0 tag.
 */
export function columnBaseForVersion(version: string): ColumnBase | undefined {
    const match = /(\d+)\.(\d+)\.(\d+)(\S*)/.exec(version);
    if (!match) {
        return undefined;
    }
    const parts = [Number(match[1]), Number(match[2]), Number(match[3])];
    const order = compareParts(parts, LAST_ZERO_BASED);
    if (order > 0) {
        return 1;
    }
    if (order === 0 && match[4] !== '') {
        return 1;
    }
    return 0;
}

function compareParts(a: readonly number[], b: readonly number[]): number {
    for (let i = 0; i < b.length; i++) {
        if (a[i] !== b[i]) {
            return a[i] - b[i];
        }
    }
    return 0;
}

/**
 * Asks each Phel binary for its version once and remembers the column base.
 * An unreadable answer is taken as the newest behaviour, 1-based, and said so
 * once per binary.
 */
export class PhelColumnBaseCache {
    private readonly bases = new Map<string, Promise<ColumnBase>>();

    constructor(
        private readonly readVersion: (command: string, cwd?: string) => Promise<string>,
        private readonly log: (message: string) => void
    ) {}

    get(command: string, cwd?: string): Promise<ColumnBase> {
        let base = this.bases.get(command);
        if (!base) {
            base = this.resolve(command, cwd);
            this.bases.set(command, base);
        }
        return base;
    }

    clear(): void {
        this.bases.clear();
    }

    private async resolve(command: string, cwd?: string): Promise<ColumnBase> {
        let version = '';
        try {
            version = await this.readVersion(command, cwd);
        } catch {
            // Read as unknown below.
        }
        return columnBaseOrNewest(version, command, this.log);
    }
}

/** `columnBaseForVersion`, falling back to 1-based with one log line. */
export function columnBaseOrNewest(
    version: string,
    source: string,
    log: (message: string) => void
): ColumnBase {
    const base = columnBaseForVersion(version);
    if (base !== undefined) {
        return base;
    }
    const shown = version.trim() || 'no answer';
    log(`Cannot read a Phel version from ${source} (${shown}); reading columns as 1-based.`);
    return 1;
}
