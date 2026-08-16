// Pure description of the `phel` task type: which subcommands a task may name,
// the argv a task definition maps to, and the default task set the provider
// offers per workspace folder. Kept free of `vscode` so it can be unit-tested.
//
// The command names mirror `contributes.taskDefinitions` in `package.json`;
// each one is a real `phel` subcommand, so the argv is the command followed by
// whatever `args` adds (`test` + `--watch` is the watch task, not a separate
// command — `phel watch` is the namespace reloader).

import type { PhelExecutableSubsystem } from './phelExecutable';

/** The `phel` subcommands a task definition can name. */
export type PhelTaskCommand = 'test' | 'watch' | 'build' | 'bench' | 'lint' | 'format' | 'run';

export const PHEL_TASK_COMMANDS: readonly PhelTaskCommand[] = [
    'test',
    'watch',
    'build',
    'bench',
    'lint',
    'format',
    'run',
];

/** The `phel` half of a `vscode.TaskDefinition` (the rest is VS Code's own). */
export interface PhelTaskSpec {
    command: PhelTaskCommand;
    args?: readonly string[];
}

/**
 * The argv `phel` is spawned with for a task: the subcommand, then its args.
 *
 * `args` comes from a hand-written `tasks.json` and is only checked against the
 * contributed schema, which VS Code reports as a squiggle rather than as a
 * refusal to run — so `"args": "--watch"` reaches here as a string, and
 * spreading that would spawn `phel test - - w a t c h`.
 */
export function taskArgv(spec: PhelTaskSpec): string[] {
    return [spec.command, ...(Array.isArray(spec.args) ? spec.args : [])];
}

/**
 * The per-command executable override, where one exists. Everything else
 * resolves straight from `phel.executablePath` (see `resolvePhelExecutable`).
 */
export function taskSubsystem(command: PhelTaskCommand): PhelExecutableSubsystem | undefined {
    switch (command) {
        case 'test':
            return 'test.command';
        case 'lint':
            return 'diagnostics.command';
        case 'format':
            return 'format.command';
        default:
            return undefined;
    }
}

export interface PhelDefaultTask extends PhelTaskSpec {
    /** Shown as `phel: <name>` in the task picker. */
    name: string;
    /** Problem matcher to attach, by its `contributes.problemMatchers` name. */
    matcher?: '$phel-lint' | '$phel-test-watch';
    /** Watch tasks keep running; VS Code needs to know so it does not wait. */
    background?: boolean;
    /** `build` / `test` map onto VS Code's own task groups. */
    group?: 'build' | 'test';
}

/**
 * The tasks offered without any `tasks.json`. `test --watch` is the one that
 * has to be a task rather than a terminal command: only a background task can
 * feed the Problems panel on every re-run.
 */
export const DEFAULT_PHEL_TASKS: readonly PhelDefaultTask[] = [
    { name: 'test', command: 'test', group: 'test' },
    {
        name: 'test --watch',
        command: 'test',
        args: ['--watch'],
        matcher: '$phel-test-watch',
        background: true,
        group: 'test',
    },
    { name: 'lint', command: 'lint', matcher: '$phel-lint' },
    { name: 'build', command: 'build', group: 'build' },
    { name: 'format', command: 'format' },
    { name: 'bench', command: 'bench' },
];
