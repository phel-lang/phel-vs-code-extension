// nREPL integration: commands that connect to a `phel nrepl` server and run
// structured ops against the live runtime.
//
//   phel.nrepl.connect / phel.nrepl.disconnect
//   phel.nrepl.eval            — eval the form under the cursor, show the result
//   phel.nrepl.evalInline      — eval the form under the cursor, show `=> …` inline
//   phel.nrepl.evalSelection   — eval the selection
//   phel.nrepl.loadFile        — load the whole file
//   phel.nrepl.reload          — reload changed namespaces
//   phel.nrepl.reloadAll       — reload every project namespace
//   phel.nrepl.runTestsInNs    — run every test in the current file's namespace
//   phel.nrepl.runTestUnderCursor — run the single deftest under the cursor
//
// Unlike the terminal REPL, results come back as structured frames, so we can
// show the value, captured stdout, and errors distinctly. A connection is
// started lazily per workspace folder and reused. When `phel.nrepl.reloadOnSave`
// is enabled, saving a `.phel` file triggers a reload of changed namespaces.

import * as vscode from 'vscode';
import { type OpResult, PhelNreplConnection } from './phelNreplClient';
import { parseNsForm } from './phelNsAnalyzer';
import { topLevelFormAt } from './phelRepl';
import { folderForDocument as folderForDoc } from './phelWorkspace';
import { PhelInlineEval } from './phelInlineEval';
import { formatInlineResult } from './phelInlineFormat';

let inlineEval: PhelInlineEval | undefined;

function isErrorResult(result: OpResult): boolean {
    return (
        result.status.includes('error') ||
        result.status.includes('eval-error') ||
        result.err.trim() !== ''
    );
}

const OUTPUT_CHANNEL_NAME = 'Phel nREPL';
const DEFTEST_HEAD_RE = /^\(deftest\s+(?:\^\S+\s+)*([^\s()[\]{}]+)/;

let output: vscode.OutputChannel | undefined;
const connections = new Map<string, PhelNreplConnection>();
const connecting = new Map<string, Promise<PhelNreplConnection>>();

function channel(): vscode.OutputChannel {
    output ??= vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    return output;
}

async function getConnection(
    folder: vscode.WorkspaceFolder,
    { create }: { create: boolean } = { create: true }
): Promise<PhelNreplConnection | undefined> {
    const key = folder.uri.toString();
    const existing = connections.get(key);
    if (existing && existing.connected) {
        return existing;
    }
    if (existing) {
        // A stale (closed) connection lingered; drop it before reconnecting.
        existing.dispose();
        connections.delete(key);
    }
    if (!create) {
        return undefined;
    }
    const inflight = connecting.get(key);
    if (inflight) {
        return inflight;
    }
    const promise = PhelNreplConnection.connect(folder, channel())
        .then((conn) => {
            connections.set(key, conn);
            connecting.delete(key);
            return conn;
        })
        .catch((err) => {
            connecting.delete(key);
            throw err;
        });
    connecting.set(key, promise);
    return promise;
}

async function withConnection(
    doc: vscode.TextDocument | undefined,
    action: (conn: PhelNreplConnection) => Promise<void>
): Promise<void> {
    const folder = folderForDoc(doc);
    if (!folder) {
        vscode.window.showWarningMessage('Open a file inside a Phel project first.');
        return;
    }
    let conn: PhelNreplConnection | undefined;
    try {
        conn = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: 'Phel nREPL' },
            () => getConnection(folder)
        );
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        channel().appendLine(`Failed to connect: ${message}`);
        channel().show(true);
        vscode.window.showErrorMessage(`Phel nREPL: ${message}`);
        return;
    }
    if (!conn) {
        return;
    }
    try {
        await action(conn);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        channel().appendLine(`Error: ${message}`);
        channel().show(true);
        vscode.window.showErrorMessage(`Phel nREPL: ${message}`);
    }
}

function reportResult(label: string, result: OpResult): void {
    const ch = channel();
    ch.appendLine(`;; ${label}`);
    if (result.out.trim()) {
        ch.append(result.out.endsWith('\n') ? result.out : result.out + '\n');
    }
    for (const value of result.values) {
        ch.appendLine(`=> ${value}`);
    }
    const hasError =
        result.status.includes('error') ||
        result.status.includes('eval-error') ||
        result.err.trim() !== '';
    if (result.err.trim()) {
        ch.appendLine(result.err.trim());
    }
    if (hasError) {
        ch.show(true);
    }
}

function nsFor(doc: vscode.TextDocument): string | undefined {
    return parseNsForm(doc.getText())?.name ?? undefined;
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
    await withConnection(doc, async (conn) => {
        const result = await conn.eval(form.text, nsFor(doc));
        reportResult('eval', result);
    });
}

/** Eval the top-level form under the cursor and show the value inline (`=> …`). */
async function evalFormInline(): Promise<void> {
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
    await withConnection(doc, async (conn) => {
        const result = await conn.eval(form.text, nsFor(doc));
        reportResult('eval', result);
        const isError = isErrorResult(result);
        inlineEval?.show(editor, form.end, {
            text: formatInlineResult(result.values, result.err, isError),
            isError,
        });
    });
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
    await withConnection(doc, async (conn) => {
        const result = await conn.eval(text, nsFor(doc));
        reportResult('eval selection', result);
    });
}

async function loadFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'phel') {
        return;
    }
    const doc = editor.document;
    await withConnection(doc, async (conn) => {
        const result = await conn.loadFile(doc.getText(), doc.uri.fsPath);
        reportResult(`load-file ${doc.uri.fsPath}`, result);
    });
}

async function reload(all: boolean): Promise<void> {
    const doc = vscode.window.activeTextEditor?.document;
    await withConnection(doc, async (conn) => {
        const result = await conn.reload(all);
        reportResult(all ? 'reload-all' : 'reload', result);
    });
}

/** Find the name of the `deftest` whose top-level form encloses the cursor. */
function deftestUnderCursor(doc: vscode.TextDocument, offset: number): string | undefined {
    const form = topLevelFormAt(doc.getText(), offset);
    if (!form) {
        return undefined;
    }
    const match = DEFTEST_HEAD_RE.exec(form.text.trimStart());
    return match ? match[1] : undefined;
}

async function runTestsInNs(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'phel') {
        return;
    }
    const doc = editor.document;
    const ns = nsFor(doc);
    if (!ns) {
        vscode.window.showWarningMessage('No (ns ...) form in this file.');
        return;
    }
    await withConnection(doc, async (conn) => {
        const result = await conn.runTests(ns);
        reportResult(`run-tests ${ns}`, result);
    });
}

async function runTestUnderCursor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'phel') {
        return;
    }
    const doc = editor.document;
    const ns = nsFor(doc);
    if (!ns) {
        vscode.window.showWarningMessage('No (ns ...) form in this file.');
        return;
    }
    const offset = doc.offsetAt(editor.selection.active);
    const testName = deftestUnderCursor(doc, offset);
    if (!testName) {
        vscode.window.showWarningMessage('Place the cursor inside a (deftest ...) form.');
        return;
    }
    await withConnection(doc, async (conn) => {
        const result = await conn.runTests(ns, testName);
        reportResult(`run-test ${ns}/${testName}`, result);
    });
}

async function connect(): Promise<void> {
    const doc = vscode.window.activeTextEditor?.document;
    const folder = folderForDoc(doc);
    if (!folder) {
        vscode.window.showWarningMessage('Open a file inside a Phel project first.');
        return;
    }
    await withConnection(doc, async (conn) => {
        channel().show(true);
        vscode.window.showInformationMessage(
            conn.attached
                ? 'Attached to the running Phel nREPL server (.nrepl-port).'
                : 'Connected to the Phel nREPL server.'
        );
    });
}

function disconnect(): void {
    const doc = vscode.window.activeTextEditor?.document;
    const folder = folderForDoc(doc);
    if (folder) {
        const key = folder.uri.toString();
        connections.get(key)?.dispose();
        connections.delete(key);
    } else {
        disposeAll();
    }
}

function disposeAll(): void {
    for (const conn of connections.values()) {
        conn.dispose();
    }
    connections.clear();
    connecting.clear();
}

export function registerNreplCommands(context: vscode.ExtensionContext): void {
    inlineEval = new PhelInlineEval();
    context.subscriptions.push(
        inlineEval,
        channel(),
        vscode.commands.registerCommand('phel.nrepl.connect', connect),
        vscode.commands.registerCommand('phel.nrepl.disconnect', disconnect),
        vscode.commands.registerCommand('phel.nrepl.eval', evalForm),
        vscode.commands.registerCommand('phel.nrepl.evalInline', evalFormInline),
        vscode.commands.registerCommand('phel.nrepl.evalSelection', evalSelection),
        vscode.commands.registerCommand('phel.nrepl.loadFile', loadFile),
        vscode.commands.registerCommand('phel.nrepl.reload', () => reload(false)),
        vscode.commands.registerCommand('phel.nrepl.reloadAll', () => reload(true)),
        vscode.commands.registerCommand('phel.nrepl.runTestsInNs', runTestsInNs),
        vscode.commands.registerCommand('phel.nrepl.runTestUnderCursor', runTestUnderCursor),
        vscode.workspace.onDidSaveTextDocument(async (doc) => {
            if (doc.languageId !== 'phel') {
                return;
            }
            const folder = folderForDoc(doc);
            if (!folder) {
                return;
            }
            const reloadOnSave = vscode.workspace
                .getConfiguration('phel', folder)
                .get<boolean>('nrepl.reloadOnSave', false);
            if (!reloadOnSave) {
                return;
            }
            // Only reload if a connection already exists; don't spin one up on save.
            const conn = await getConnection(folder, { create: false });
            if (!conn) {
                return;
            }
            try {
                const result = await conn.reload(false);
                reportResult('reload (on save)', result);
            } catch (err) {
                channel().appendLine(
                    `reload on save failed: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        }),
        new vscode.Disposable(disposeAll)
    );
}
