// The `phel` task type: definition -> argv, the executable override each
// subcommand resolves through, and the default task set. The enum in
// `package.json` is what the editor validates a hand-written `tasks.json`
// against, so it is checked against the same list the provider builds from.

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    DEFAULT_PHEL_TASKS,
    PHEL_TASK_COMMANDS,
    type PhelTaskSpec,
    taskArgv,
    taskSubsystem,
} from '../phelTasks';

const manifest: {
    contributes: {
        taskDefinitions: {
            type: string;
            required: string[];
            properties: Record<string, unknown>;
        }[];
    };
} = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));

const definition = manifest.contributes.taskDefinitions.find((d) => d.type === 'phel');

describe('phel task definitions', () => {
    it('accepts exactly the commands the provider knows', () => {
        const properties = definition?.properties as { command: { enum: string[] } };
        assert.deepEqual(properties.command.enum, [...PHEL_TASK_COMMANDS]);
    });

    it('requires a command', () => {
        assert.deepEqual(definition?.required, ['command']);
    });
});

describe('taskArgv', () => {
    it('runs the bare subcommand when the task has no args', () => {
        assert.deepEqual(taskArgv({ command: 'lint' }), ['lint']);
    });

    it('appends the task args after the subcommand', () => {
        assert.deepEqual(taskArgv({ command: 'test', args: ['--watch'] }), ['test', '--watch']);
        assert.deepEqual(taskArgv({ command: 'run', args: ['src/app/main.phel'] }), [
            'run',
            'src/app/main.phel',
        ]);
    });

    it('copies the args instead of aliasing the definition', () => {
        const args = ['--filter=sum'];
        const argv = taskArgv({ command: 'bench', args });
        argv.push('--revs=10');
        assert.deepEqual(args, ['--filter=sum']);
    });

    it('drops args that a hand-written tasks.json wrote as a bare string', () => {
        // Spreading the string would spawn `phel test - - w a t c h`.
        const spec = { command: 'test', args: '--watch' } as unknown as PhelTaskSpec;
        assert.deepEqual(taskArgv(spec), ['test']);
    });
});

describe('taskSubsystem', () => {
    it('routes the commands that have their own executable setting', () => {
        assert.equal(taskSubsystem('test'), 'test.command');
        assert.equal(taskSubsystem('lint'), 'diagnostics.command');
        assert.equal(taskSubsystem('format'), 'format.command');
    });

    it('leaves the rest on phel.executablePath', () => {
        for (const command of ['watch', 'build', 'bench', 'run'] as const) {
            assert.equal(taskSubsystem(command), undefined, command);
        }
    });
});

describe('default phel tasks', () => {
    it('offers test, watch, lint, build, format and bench', () => {
        assert.deepEqual(
            DEFAULT_PHEL_TASKS.map((task) => [task.name, taskArgv(task)]),
            [
                ['test', ['test']],
                ['test --watch', ['test', '--watch']],
                ['lint', ['lint']],
                ['build', ['build']],
                ['format', ['format']],
                ['bench', ['bench']],
            ]
        );
    });

    it('attaches a matcher to the two commands that report diagnostics', () => {
        const matchers = DEFAULT_PHEL_TASKS.filter((task) => task.matcher !== undefined);
        assert.deepEqual(
            matchers.map((task) => [task.name, task.matcher]),
            [
                ['test --watch', '$phel-test-watch'],
                ['lint', '$phel-lint'],
            ]
        );
    });

    it('marks only the watch task as a background task', () => {
        const background = DEFAULT_PHEL_TASKS.filter((task) => task.background);
        assert.deepEqual(
            background.map((task) => task.name),
            ['test --watch']
        );
    });
});
