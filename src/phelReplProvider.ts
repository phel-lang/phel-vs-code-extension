// REPL integration: spawns `phel repl` in an integrated terminal and lets
// the user send the form under the cursor, the current selection, or the
// whole file via commands / keybindings.
//
// One terminal per workspace folder is reused; closing the terminal makes
// the next eval start a fresh one.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { flattenForTerminal, nextTopLevelFormAfter, topLevelFormAt } from './phelRepl';

const REPL_TERMINAL_NAME = 'Phel REPL';

interface ReplCommandConfig {
    command: string;
    args: readonly string[];
    cwd: string;
}

function workspaceFolderForDoc(doc?: vscode.TextDocument): vscode.WorkspaceFolder | undefined {
    if (doc && doc.uri.scheme === 'file') {
        return vscode.workspace.getWorkspaceFolder(doc.uri) ?? undefined;
    }
    return vscode.workspace.workspaceFolders?.[0];
}

function resolveCommand(folder: vscode.WorkspaceFolder | undefined): ReplCommandConfig {
    const config = vscode.workspace.getConfiguration('phel', folder);
    const cmd = config.get<string>('repl.command', 'vendor/bin/phel');
    const args = config.get<string[]>('repl.args', ['repl']);
    const cwd = folder?.uri.fsPath ?? process.cwd();
    const absolute = path.isAbsolute(cmd) ? cmd : path.join(cwd, cmd);
    return { command: absolute, args, cwd };
}

function findTerminal(): vscode.Terminal | undefined {
    return vscode.window.terminals.find((t) => t.name === REPL_TERMINAL_NAME);
}

function ensureTerminal(folder: vscode.WorkspaceFolder | undefined): vscode.Terminal {
    const existing = findTerminal();
    if (existing) {
        existing.show(true);
        return existing;
    }
    const cfg = resolveCommand(folder);
    const term = vscode.window.createTerminal({
        name: REPL_TERMINAL_NAME,
        cwd: cfg.cwd,
        shellPath: cfg.command,
        shellArgs: [...cfg.args],
    });
    term.show(true);
    return term;
}

function sendToRepl(text: string, folder: vscode.WorkspaceFolder | undefined): void {
    const term = ensureTerminal(folder);
    term.sendText(text, true);
}

async function evalForm(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'phel') {
        return;
    }
    const doc = editor.document;
    const offset = doc.offsetAt(editor.selection.active);
    const form = topLevelFormAt(doc.getText(), offset);
    if (!form) {
        vscode.window.showWarningMessage('No Phel form under cursor.');
        return;
    }
    sendToRepl(flattenForTerminal(form.text), workspaceFolderForDoc(doc));
}

async function evalSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'phel') {
        return;
    }
    const doc = editor.document;
    const sel = editor.selection;
    const text = sel.isEmpty ? doc.lineAt(sel.active.line).text : doc.getText(sel);
    if (!text.trim()) {
        return;
    }
    sendToRepl(flattenForTerminal(text), workspaceFolderForDoc(doc));
}

async function evalNextForm(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'phel') {
        return;
    }
    const doc = editor.document;
    const offset = doc.offsetAt(editor.selection.active);
    const form = nextTopLevelFormAfter(doc.getText(), offset);
    if (!form) {
        return;
    }
    sendToRepl(flattenForTerminal(form.text), workspaceFolderForDoc(doc));
    const newPos = doc.positionAt(form.end);
    editor.selection = new vscode.Selection(newPos, newPos);
    editor.revealRange(new vscode.Range(newPos, newPos));
}

async function evalFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'phel') {
        return;
    }
    const text = editor.document.getText().trim();
    if (!text) {
        return;
    }
    sendToRepl(flattenForTerminal(text), workspaceFolderForDoc(editor.document));
}

function startRepl(): void {
    const folder = workspaceFolderForDoc(vscode.window.activeTextEditor?.document);
    ensureTerminal(folder);
}

export function registerReplCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('phel.repl.start', startRepl),
        vscode.commands.registerCommand('phel.repl.evalForm', evalForm),
        vscode.commands.registerCommand('phel.repl.evalSelection', evalSelection),
        vscode.commands.registerCommand('phel.repl.evalNextForm', evalNextForm),
        vscode.commands.registerCommand('phel.repl.evalFile', evalFile)
    );
}
