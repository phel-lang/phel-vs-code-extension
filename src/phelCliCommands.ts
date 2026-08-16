// Pure helpers for the Phel CLI command wrappers (template parsing, build
// args). Kept free of `vscode` so they can be unit-tested.

export interface PhelTemplate {
    name: string;
    description: string;
}

/**
 * Parse the output of `phel init --list-templates`. Each template line looks
 * like `  <name> - <description>`; the surrounding banner lines are ignored.
 */
export function parseTemplates(output: string): PhelTemplate[] {
    const templates: PhelTemplate[] = [];
    for (const rawLine of output.split(/\r?\n/)) {
        const line = rawLine.trimEnd();
        // Template rows are indented; skip headings/blank/usage lines.
        if (!/^\s{2,}\S/.test(line)) {
            continue;
        }
        const trimmed = line.trim();
        const sep = trimmed.indexOf(' - ');
        if (sep < 0) {
            // A bare template name with no description.
            if (/^[A-Za-z0-9._-]+$/.test(trimmed)) {
                templates.push({ name: trimmed, description: '' });
            }
            continue;
        }
        const name = trimmed.slice(0, sep).trim();
        const description = trimmed.slice(sep + 3).trim();
        if (/^[A-Za-z0-9._-]+$/.test(name)) {
            templates.push({ name, description });
        }
    }
    return templates;
}

/** Options `phel bench` accepts, per `BenchCommand::configure()`. */
export interface BenchOptions {
    /** Files or namespaces to benchmark; defaults to the whole `tests` dir. */
    paths?: readonly string[];
    /** `--filter`: only benchmarks whose name contains this substring. */
    filter?: string;
    /** `--revs`: calls per measured iteration. */
    revs?: number;
    /** `--iterations`: measured iterations per benchmark. */
    iterations?: number;
    /** `--warmup`: unmeasured iterations run first. */
    warmup?: number;
    /** `--store`: write the results to this file as a baseline. */
    store?: string;
    /** `--ref`: compare against the baseline stored in this file. */
    ref?: string;
    /** `--tolerance`: fail when slower than the baseline by more than this percentage. */
    tolerance?: number;
}

/** Build the argument list for `phel bench`. */
export function benchArgs(options: BenchOptions = {}): string[] {
    const args = ['bench'];
    for (const path of options.paths ?? []) {
        args.push(path);
    }
    // Every option takes a value, so an empty string would consume the next
    // argument as its own. Blank input means "not set".
    const push = (name: string, value: string | number | undefined): void => {
        const text = typeof value === 'number' ? String(value) : value?.trim();
        if (text) {
            args.push(`--${name}=${text}`);
        }
    };
    push('filter', options.filter);
    push('revs', options.revs);
    push('iterations', options.iterations);
    push('warmup', options.warmup);
    push('store', options.store);
    push('ref', options.ref);
    push('tolerance', options.tolerance);
    return args;
}

/** Build the argument list for `phel balance`. */
export function balanceArgs(options: { paths?: readonly string[]; fix?: boolean } = {}): string[] {
    const args = ['balance'];
    for (const path of options.paths ?? []) {
        args.push(path);
    }
    if (options.fix) {
        args.push('--fix');
    }
    return args;
}

export type OptimizationLevel = '0' | '2';

/** Build the argument list for `phel build`. */
export function buildArgs(options: {
    optimizationLevel?: OptimizationLevel;
    report?: boolean;
}): string[] {
    const args = ['build'];
    if (options.optimizationLevel !== undefined) {
        args.push('-O', options.optimizationLevel);
    }
    if (options.report) {
        args.push('--report');
    }
    return args;
}
