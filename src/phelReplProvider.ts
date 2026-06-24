// REPL integration: spawns `phel repl` in an integrated terminal and lets
// the user send the form under the cursor, the current selection, or the
// whole file via commands / keybindings.
//
// One terminal per workspace folder is reused; closing the terminal makes
// the next eval start a fresh one. The provider also tracks which Phel
// namespace each terminal is currently in and emits `(in-ns ...)` before
// evaluating a form from a different namespace, so cross-file evals don't
// silently land in the previous file's `ns`.
//
// Every form sent to the REPL is appended to `.vscode/phel-repl-history.phel`
// in the corresponding workspace folder when `phel.repl.history.enabled` is
// true (the default).

import * as vscode from 'vscode';
import { resolvePhelExecutable } from './phelExecutable';
import { parseNsForm } from './phelNsAnalyzer';
import { flattenForTerminal, nextTopLevelFormAfter, topLevelFormAt } from './phelRepl';
import { folderForDocument as workspaceFolderForDoc } from './phelWorkspace';

const REPL_TERMINAL_NAME = 'Phel REPL';
const HISTORY_FILE = '.vscode/phel-repl-history.phel';
const terminalNs = new WeakMap<vscode.Terminal, string>();

interface ReplCommandConfig {
    command: string;
    args: readonly string[];
    cwd: string;
}

function resolveCommand(folder: vscode.WorkspaceFolder | undefined): ReplCommandConfig {
    const config = vscode.workspace.getConfiguration('phel', folder);
    const args = config.get<string[]>('repl.args', ['repl']);
    const cwd = folder?.uri.fsPath ?? process.cwd();
    const absolute = resolvePhelExecutable('repl.command', folder);
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

function detectDocumentNs(doc: vscode.TextDocument): string | null {
    const ns = parseNsForm(doc.getText());
    return ns?.name ?? null;
}

function maybeSwitchNs(term: vscode.Terminal, doc: vscode.TextDocument | undefined): void {
    if (!doc) {
        return;
    }
    const ns = detectDocumentNs(doc);
    if (!ns) {
        return;
    }
    if (terminalNs.get(term) === ns) {
        return;
    }
    term.sendText(`(in-ns '${ns})`, true);
    terminalNs.set(term, ns);
}

async function appendHistory(
    folder: vscode.WorkspaceFolder | undefined,
    text: string
): Promise<void> {
    if (!folder) {
        return;
    }
    const enabled = vscode.workspace
        .getConfiguration('phel', folder)
        .get<boolean>('repl.history.enabled', true);
    if (!enabled) {
        return;
    }
    const uri = vscode.Uri.joinPath(folder.uri, HISTORY_FILE);
    const stamp = new Date().toISOString();
    const entry = `;; ${stamp}\n${text}\n\n`;
    try {
        const existing = await vscode.workspace.fs.readFile(uri);
        const merged = Buffer.concat([Buffer.from(existing), Buffer.from(entry, 'utf-8')]);
        await vscode.workspace.fs.writeFile(uri, merged);
    } catch {
        try {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(entry, 'utf-8'));
        } catch {
            // Couldn't create the history file (read-only workspace, etc); skip.
        }
    }
}

interface SendOptions {
    /** Document the form was extracted from; used for `(in-ns ...)` sync. */
    doc?: vscode.TextDocument;
}

function sendToRepl(
    text: string,
    folder: vscode.WorkspaceFolder | undefined,
    options: SendOptions = {}
): void {
    const term = ensureTerminal(folder);
    if (options.doc) {
        maybeSwitchNs(term, options.doc);
    }
    term.sendText(text, true);
    void appendHistory(folder, text);
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
    sendToRepl(flattenForTerminal(form.text), workspaceFolderForDoc(doc), { doc });
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
    sendToRepl(flattenForTerminal(text), workspaceFolderForDoc(doc), { doc });
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
    sendToRepl(flattenForTerminal(form.text), workspaceFolderForDoc(doc), { doc });
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
    sendToRepl(flattenForTerminal(text), workspaceFolderForDoc(editor.document), {
        doc: editor.document,
    });
}

async function switchNs(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'phel') {
        return;
    }
    const ns = detectDocumentNs(editor.document);
    if (!ns) {
        vscode.window.showWarningMessage('No (ns ...) form in this file.');
        return;
    }
    const folder = workspaceFolderForDoc(editor.document);
    const term = ensureTerminal(folder);
    term.sendText(`(in-ns '${ns})`, true);
    terminalNs.set(term, ns);
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
        vscode.commands.registerCommand('phel.repl.evalFile', evalFile),
        vscode.commands.registerCommand('phel.repl.switchNs', switchNs),
        vscode.window.onDidCloseTerminal((t) => {
            terminalNs.delete(t);
        })
    );
}
