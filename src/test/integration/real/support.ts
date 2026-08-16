// Shared plumbing for the real-CLI suites.
//
// These run in the third host (`PHEL_ITEST_SUITES=real`), opened on the project
// `scripts/make-real-cli-fixture.sh` built. Unlike `test-fixtures/workspace`,
// that project is not in the repo and its path is only known at runtime, so
// everything here is anchored to the workspace folder the host was launched
// with rather than to a path relative to `__dirname`.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { waitFor } from '../helpers';

export {
    activateExtension,
    delay,
    labelOf,
    positionOf,
    terminalArgs,
    terminalCwd,
    waitFor,
} from '../helpers';

/** The Phel project this host was launched with. */
export function projectFolder(): vscode.WorkspaceFolder {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        throw new Error('the real-CLI host was launched without a workspace folder');
    }
    return folder;
}

export function projectPath(...segments: string[]): string {
    return path.join(projectFolder().uri.fsPath, ...segments);
}

export function projectUri(...segments: string[]): vscode.Uri {
    return vscode.Uri.file(projectPath(...segments));
}

/** Open a project file and show it, so editor-scoped commands have a target. */
export async function openProject(...segments: string[]): Promise<vscode.TextDocument> {
    const doc = await vscode.workspace.openTextDocument(projectUri(...segments));
    await vscode.window.showTextDocument(doc, { preview: false });
    return doc;
}

/** Append `text` to `doc` without saving, which is what "while you type" means here. */
export async function type(doc: vscode.TextDocument, text: string): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, new vscode.Position(doc.lineCount, 0), text);
    if (!(await vscode.workspace.applyEdit(edit))) {
        throw new Error(`could not edit ${doc.uri.fsPath}`);
    }
}

/** Append `text` and save, so the on-save passes (and the CLI) see it. */
export async function typeAndSave(doc: vscode.TextDocument, text: string): Promise<void> {
    await type(doc, text);
    if (!(await doc.save())) {
        throw new Error(`could not save ${doc.uri.fsPath}`);
    }
}

/**
 * Run `command` and wait for the terminal it opens to exit, then answer with
 * its exit status. The commands that shell out do so through
 * `runInTerminal`, whose process *is* the terminal's shell, so the terminal
 * closing is the process exiting.
 */
export async function terminalExitOf(
    command: string,
    ...args: unknown[]
): Promise<vscode.TerminalExitStatus> {
    const opened: vscode.Terminal[] = [];
    let closed: vscode.Terminal | undefined;
    const subs = [
        vscode.window.onDidOpenTerminal((t) => opened.push(t)),
        vscode.window.onDidCloseTerminal((t) => {
            if (opened.includes(t)) {
                closed = t;
            }
        }),
    ];
    try {
        await vscode.commands.executeCommand(command, ...args);
        await waitFor(`the terminal ${command} opens`, () => opened[0]);
        const terminal = await waitFor(`the terminal ${command} opened to exit`, () => closed);
        return await waitFor(
            `the exit status of ${command}`,
            () => terminal.exitStatus ?? undefined
        );
    } finally {
        subs.forEach((s) => s.dispose());
    }
}

/** Read a project file off disk (not through a buffer). */
export function readProjectFile(...segments: string[]): Promise<string> {
    return fs.readFile(projectPath(...segments), 'utf-8');
}

/** Write a project file to disk, for the cases that change what the CLI reads. */
export function writeProjectFile(contents: string, ...segments: string[]): Promise<void> {
    return fs.writeFile(projectPath(...segments), contents, 'utf-8');
}
