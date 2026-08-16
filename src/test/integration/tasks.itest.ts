// The `phel` task type as the editor sees it. `fetchTasks` runs the whole
// contribution through VS Code: a task definition that does not validate
// against `contributes.taskDefinitions`, or a matcher name that resolves to
// nothing, is dropped there and nowhere else.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { WORKSPACE_ROOT, activateExtension } from './helpers';

describe('phel tasks', function () {
    before(async function () {
        await activateExtension();
    });

    it('offers the default task set', async function () {
        const tasks = await vscode.tasks.fetchTasks({ type: 'phel' });

        assert.deepEqual(
            tasks
                .filter((task) => task.source === 'phel')
                .map((task) => [task.name, task.definition.command, task.definition.args]),
            [
                ['test', 'test', undefined],
                ['test --watch', 'test', ['--watch']],
                ['lint', 'lint', undefined],
                ['build', 'build', undefined],
                ['format', 'format', undefined],
                ['bench', 'bench', undefined],
            ]
        );
    });

    it('fills in the execution for a task written in tasks.json', async function () {
        // The fixture's `.vscode/tasks.json` names a subcommand no default task
        // uses, so the editor has to go through `resolveTask` to run it.
        const tasks = await vscode.tasks.fetchTasks({ type: 'phel' });
        const configured = tasks.find((task) => task.name === 'run main');

        assert.ok(configured, `no configured task among ${tasks.map((t) => t.name)}`);
        assert.ok(configured.execution instanceof vscode.ProcessExecution);
        assert.deepEqual(configured.execution.args, ['run', 'src/app/main.phel']);
        assert.equal(configured.execution.options?.cwd, WORKSPACE_ROOT);
    });

    it('runs each task as a process in the folder it belongs to', async function () {
        const tasks = await vscode.tasks.fetchTasks({ type: 'phel' });

        for (const task of tasks) {
            assert.ok(
                task.execution instanceof vscode.ProcessExecution,
                `${task.name} is not a ProcessExecution`
            );
            assert.equal(task.execution.options?.cwd, WORKSPACE_ROOT, task.name);
        }
    });

    it('runs the watch task in the background, without stealing the terminal', async function () {
        const tasks = await vscode.tasks.fetchTasks({ type: 'phel' });
        const watch = tasks.find((task) => task.name === 'test --watch');

        assert.ok(watch, 'no test --watch task');
        assert.equal(watch.isBackground, true);
        assert.equal(watch.presentationOptions.reveal, vscode.TaskRevealKind.Silent);
        assert.deepEqual(watch.problemMatchers, ['$phel-test-watch']);
    });
});
