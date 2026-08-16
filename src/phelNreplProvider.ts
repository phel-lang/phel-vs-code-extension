// nREPL integration: commands that connect to a `phel nrepl` server and run
// structured ops against the live runtime.
//
//   phel.nrepl.connect / phel.nrepl.disconnect
//   phel.nrepl.eval            — eval the form under the cursor, show the result
//   phel.nrepl.evalInline      — eval the form under the cursor, show `=> …` inline
//   phel.nrepl.evalSelection   — eval the selection
//   phel.nrepl.evalToComment   — eval the form, write the value under it as `;; => …`
//   phel.nrepl.evalAndReplace  — eval the form, replace it with its value
//   phel.nrepl.showResult      — open the last value in a read-only document
//   phel.nrepl.loadFile        — load the whole file
//   phel.nrepl.reload          — reload changed namespaces
//   phel.nrepl.reloadAll       — reload every project namespace
//   phel.nrepl.runTestsInNs    — run every test in the current file's namespace
//   phel.nrepl.runTestUnderCursor — run the single deftest under the cursor
//
// Unlike the terminal REPL, results come back as structured frames, so we can
// show the value, captured stdout, and errors distinctly. A connection is
// started lazily per workspace folder and reused. When `phel.nrepl.reloadOnSave`
// is enabled, saving a `.phel` file triggers a reload of changed namespaces,
// and while a connection is live hovering a symbol shows its current value
// (see phelNreplHoverProvider.ts). Neither opens a connection on its own.

import * as vscode from 'vscode';
import { type EvalEdit, commentResultEdit, replaceFormEdit } from './phelEvalEdits';
import { isErrorResult, type OpResult, PhelNreplConnection } from './phelNreplClient';
import { parseNsForm } from './phelNsAnalyzer';
import { topLevelFormAt } from './phelRepl';
import { folderForDocument as folderForDoc } from './phelWorkspace';
import { PhelInlineEval } from './phelInlineEval';
import { formatInlineResult } from './phelInlineFormat';
import { resolvePhelExecutable } from './phelExecutable';
import { PhelNreplHoverProvider } from './phelNreplHoverProvider';
import { phelRuntimeState } from './phelRuntimeState';

let inlineEval: PhelInlineEval | undefined;
let lastResult: LastResultDocument | undefined;

const OUTPUT_CHANNEL_NAME = 'Phel nREPL';
const DEFTEST_HEAD_RE = /^\(deftest\s+(?:\^\S+\s+)*([^\s()[\]{}]+)/;

/** Scheme of the read-only document `phel.nrepl.showResult` opens. */
const RESULT_SCHEME = 'phel-result';
/** `.phel` so the host gives the document the Phel language, and its highlighting. */
const RESULT_URI = vscode.Uri.parse(`${RESULT_SCHEME}:last.phel`);

let output: vscode.OutputChannel | undefined;
const connections = new Map<string, PhelNreplConnection>();
const connecting = new Map<string, Promise<PhelNreplConnection>>();

function channel(): vscode.OutputChannel {
    output ??= vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    return output;
}

/**
 * The live connection for `folder`, or undefined when there is none. Never
 * starts a server: the passive features (hover evaluation) may only use a
 * connection the user already asked for.
 */
export function peekConnection(folder: vscode.WorkspaceFolder): PhelNreplConnection | undefined {
    const existing = connections.get(folder.uri.toString());
    return existing?.connected ? existing : undefined;
}

async function getConnection(
    folder: vscode.WorkspaceFolder,
    { create }: { create: boolean } = { create: true }
): Promise<PhelNreplConnection | undefined> {
    const key = folder.uri.toString();
    const existing = connections.get(key);
    if (existing && existing.connected) {
        publishState(key, existing);
        return existing;
    }
    if (existing) {
        // A stale (closed) connection lingered; drop it before reconnecting.
        existing.dispose();
        connections.delete(key);
        phelRuntimeState.set('nrepl', key, 'disconnected');
    }
    if (!create) {
        return undefined;
    }
    const inflight = connecting.get(key);
    if (inflight) {
        return inflight;
    }
    phelRuntimeState.set('nrepl', key, 'connecting');
    let opened: PhelNreplConnection | undefined;
    const promise = PhelNreplConnection.connect(
        folder,
        channel(),
        resolvePhelExecutable('repl.command', folder),
        // The socket can close without anyone asking (the server exits, or it
        // crashes); the status bar has to stop claiming a connection then. A
        // connection that is no longer the folder's says nothing about it.
        () => {
            if (opened !== undefined && connections.get(key) === opened) {
                phelRuntimeState.set('nrepl', key, 'disconnected');
            }
        }
    )
        .then((conn) => {
            opened = conn;
            connections.set(key, conn);
            connecting.delete(key);
            publishState(key, conn);
            return conn;
        })
        .catch((err) => {
            connecting.delete(key);
            phelRuntimeState.set('nrepl', key, 'disconnected');
            throw err;
        });
    connecting.set(key, promise);
    return promise;
}

/** A live connection is `attached` when it joined a server the user started. */
function publishState(key: string, conn: PhelNreplConnection): void {
    phelRuntimeState.set('nrepl', key, conn.attached ? 'attached' : 'connected');
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
    const hasError = isErrorResult(result);
    if (result.err.trim()) {
        ch.appendLine(result.err.trim());
    }
    if (hasError) {
        ch.show(true);
    }
}

/**
 * The value a result carries, as text: the printed values, the error when the
 * server reported one, `nil` when an op returned nothing.
 *
 * This is the captured value, not a re-read of `*1`. Phel's nREPL keeps a
 * per-session `*1`/`*2`/`*3` ring, but it surfaces them as fields on the eval
 * response — they are not bound in the environment the code compiles in, so
 * `(phel.pprint/pprint-str *1)` would come back an unresolved symbol.
 */
function resultText(result: OpResult): string {
    if (isErrorResult(result)) {
        return result.err.trim() || 'error';
    }
    return result.values.join('\n') || 'nil';
}

/**
 * Backs `phel-result:last.phel`. A content provider rather than a webview: the
 * result of a Phel eval is Phel data, so the editor already knows how to
 * highlight it, the document is read-only by construction, and it can be
 * pinned and diffed like any other. Costs nothing in the bundle.
 */
class LastResultDocument implements vscode.TextDocumentContentProvider {
    private text = '';
    private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this.emitter.event;

    provideTextDocumentContent(): string {
        return this.text;
    }

    /** Record the newest value; the open document (if any) redraws with it. */
    set(text: string): void {
        this.text = text;
        this.emitter.fire(RESULT_URI);
    }

    dispose(): void {
        this.emitter.dispose();
    }
}

/** Every eval command feeds the last-result document, open or not. */
function rememberResult(result: OpResult): void {
    lastResult?.set(resultText(result));
}

/**
 * Evaluate `code` over a connection that already exists for `folder`, reporting
 * into the nREPL output channel. Answers false when nothing is connected: like
 * hover evaluation, this may only use a connection the user asked for (the REPL
 * history picker offers it as an extra, and must not start a server behind one).
 */
export async function evalOverLiveConnection(
    folder: vscode.WorkspaceFolder,
    code: string
): Promise<boolean> {
    const conn = peekConnection(folder);
    if (!conn) {
        return false;
    }
    const result = await conn.eval(code);
    reportResult('eval (history)', result);
    rememberResult(result);
    return true;
}

function nsFor(doc: vscode.TextDocument): string | undefined {
    return parseNsForm(doc.getText())?.name ?? undefined;
}

/** Apply an offset-based edit from `phelEvalEdits` to the editor's buffer. */
async function applyEvalEdit(editor: vscode.TextEditor, edit: EvalEdit): Promise<void> {
    const doc = editor.document;
    const range = new vscode.Range(doc.positionAt(edit.start), doc.positionAt(edit.end));
    await editor.edit((builder) => builder.replace(range, edit.text));
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
        rememberResult(result);
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
        rememberResult(result);
        const isError = isErrorResult(result);
        inlineEval?.show(editor, form.end, {
            text: formatInlineResult(result.values, result.err, isError),
            isError,
        });
    });
}

/**
 * Eval the top-level form under the cursor and write the value under it as a
 * `;; => …` comment, replacing the one a previous eval of the same form left.
 */
async function evalToComment(): Promise<void> {
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
        reportResult('eval to comment', result);
        rememberResult(result);
        await applyEvalEdit(editor, commentResultEdit(doc.getText(), form.end, resultText(result)));
    });
}

/**
 * Replace the top-level form under the cursor with what it evaluated to. An
 * error result is reported and nothing is written: the form is the only copy of
 * itself, and a stack trace in its place would lose it.
 */
async function evalAndReplace(): Promise<void> {
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
        reportResult('eval and replace', result);
        rememberResult(result);
        if (isErrorResult(result)) {
            vscode.window.showWarningMessage(
                'Phel nREPL: the form errored; it was left as it is (see the Phel nREPL output).'
            );
            return;
        }
        await applyEvalEdit(editor, replaceFormEdit(form, resultText(result)));
    });
}

/** Open (or focus) the read-only document holding the value of the last eval. */
async function showResult(): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(RESULT_URI);
    await vscode.window.showTextDocument(doc, {
        preview: false,
        viewColumn: vscode.ViewColumn.Beside,
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
        rememberResult(result);
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
        phelRuntimeState.set('nrepl', key, 'disconnected');
    } else {
        disposeAll();
    }
}

function disposeAll(): void {
    for (const [key, conn] of connections) {
        conn.dispose();
        phelRuntimeState.set('nrepl', key, 'disconnected');
    }
    connections.clear();
    connecting.clear();
}

export function registerNreplCommands(context: vscode.ExtensionContext): void {
    inlineEval = new PhelInlineEval();
    lastResult = new LastResultDocument();
    context.subscriptions.push(
        inlineEval,
        lastResult,
        channel(),
        vscode.workspace.registerTextDocumentContentProvider(RESULT_SCHEME, lastResult),
        // Hover evaluation only ever uses a connection that already exists, so
        // it is registered up front and stays inert until one does.
        vscode.languages.registerHoverProvider('phel', new PhelNreplHoverProvider(peekConnection)),
        vscode.commands.registerCommand('phel.nrepl.connect', connect),
        vscode.commands.registerCommand('phel.nrepl.disconnect', disconnect),
        vscode.commands.registerCommand('phel.nrepl.eval', evalForm),
        vscode.commands.registerCommand('phel.nrepl.evalInline', evalFormInline),
        vscode.commands.registerCommand('phel.nrepl.evalSelection', evalSelection),
        vscode.commands.registerCommand('phel.nrepl.evalToComment', evalToComment),
        vscode.commands.registerCommand('phel.nrepl.evalAndReplace', evalAndReplace),
        vscode.commands.registerCommand('phel.nrepl.showResult', showResult),
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
