// The `phel` task type. Two things a terminal command cannot do: be bound to
// `Run Build Task` / `Run Test Task`, and feed the Problems panel while it
// runs. The default set covers the subcommands worth either — `test`,
// `test --watch`, `lint`, `build`, `format`, `bench` — with the problem
// matchers contributed in `package.json` (`$phel-lint`, `$phel-test-watch`)
// attached to the two that report diagnostics.
//
// One set of tasks per workspace folder: `phel` resolves its project from the
// cwd, so in a multi-root workspace each folder gets its own tasks, each
// running in its own root and with its own `phel.*` executable settings.

import * as vscode from 'vscode';
import { resolvePhelExecutable } from './phelExecutable';
import { toInvocation } from './phelInvocation';
import {
    DEFAULT_PHEL_TASKS,
    type PhelDefaultTask,
    type PhelTaskSpec,
    taskArgv,
    taskSubsystem,
} from './phelTasks';

export const PHEL_TASK_TYPE = 'phel';

/** The task definition as it appears in `tasks.json`. */
interface PhelTaskDefinition extends vscode.TaskDefinition, PhelTaskSpec {
    type: typeof PHEL_TASK_TYPE;
}

class PhelTaskProvider implements vscode.TaskProvider {
    provideTasks(): vscode.Task[] {
        const folders = vscode.workspace.workspaceFolders ?? [];
        return folders.flatMap((folder) =>
            DEFAULT_PHEL_TASKS.map((task) => buildDefaultTask(task, folder))
        );
    }

    /**
     * Fills in the execution for a `phel` task written by hand in `tasks.json`.
     * VS Code hands back the very definition object it read from the file and
     * matches the result by identity, so it goes into the new task untouched.
     *
     * Only the execution is filled in: `problemMatcher`, `isBackground` and
     * `presentation` belong to the entry the user wrote, and adding our own
     * would report every problem twice for a task that already names one.
     */
    resolveTask(task: vscode.Task): vscode.Task | undefined {
        const definition = task.definition as PhelTaskDefinition;
        if (typeof definition.command !== 'string') {
            return undefined;
        }
        const folder = folderOf(task.scope);
        if (!folder) {
            return undefined;
        }
        return new vscode.Task(
            definition,
            folder,
            task.name,
            PHEL_TASK_TYPE,
            execution(definition, folder)
        );
    }
}

function buildDefaultTask(spec: PhelDefaultTask, folder: vscode.WorkspaceFolder): vscode.Task {
    const definition: PhelTaskDefinition = {
        type: PHEL_TASK_TYPE,
        command: spec.command,
        ...(spec.args ? { args: [...spec.args] } : {}),
    };
    const task = new vscode.Task(
        definition,
        folder,
        spec.name,
        PHEL_TASK_TYPE,
        execution(definition, folder),
        spec.matcher ? [spec.matcher] : []
    );
    task.isBackground = spec.background ?? false;
    if (spec.background) {
        // A watch task is started once and then reports through the Problems
        // panel; stealing focus on every re-run would be unusable.
        task.presentationOptions = { reveal: vscode.TaskRevealKind.Silent };
    }
    if (spec.group !== undefined) {
        task.group = spec.group === 'build' ? vscode.TaskGroup.Build : vscode.TaskGroup.Test;
    }
    return task;
}

/**
 * `phel <argv>` in the folder's root. `toInvocation` is what makes it spawnable
 * on Windows, where `vendor/bin/phel` runs as `php vendor/bin/phel …`.
 */
function execution(spec: PhelTaskSpec, folder: vscode.WorkspaceFolder): vscode.ProcessExecution {
    const executable = resolvePhelExecutable(taskSubsystem(spec.command), folder);
    const invocation = toInvocation(executable, taskArgv(spec));
    return new vscode.ProcessExecution(invocation.file, invocation.args, {
        cwd: folder.uri.fsPath,
    });
}

/** The folder a task runs in: its own scope, else the first workspace folder. */
function folderOf(scope: vscode.Task['scope']): vscode.WorkspaceFolder | undefined {
    if (scope !== undefined && typeof scope === 'object') {
        return scope;
    }
    return vscode.workspace.workspaceFolders?.[0];
}

export function registerTaskProvider(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.tasks.registerTaskProvider(PHEL_TASK_TYPE, new PhelTaskProvider())
    );
}
