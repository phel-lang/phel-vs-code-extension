// Pure helpers for the Phel CLI command wrappers (template parsing, build
// args, shell quoting). Kept free of `vscode` so they can be unit-tested.

/** POSIX-quote a single argument so paths/names with spaces survive the shell. */
export function shellQuote(arg: string): string {
    return /[\s"'$`\\]/.test(arg) ? `'${arg.replace(/'/g, "'\\''")}'` : arg;
}

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
