// The editor half of namespace hygiene:
//
//   * the `phel-ns` collection, which fades a `(:require ...)` entry (or one of
//     its `:refer` names) nothing in the file uses;
//   * `(ns ...)` inserted into a `.phel` file that was just created empty;
//   * **Phel: Go to Test / Source File**, which walks between the two halves of
//     a namespace and offers to scaffold the missing one.
//
// The findings are hints rather than warnings, and they are dropped wherever
// `phel lint` has already reported the same entry as `phel/unused-require`.
// The CLI is the authority: it sees the whole project and it is what CI runs.
// Between saves it has not run yet, and that gap is the whole point of this
// collection - so ours goes away the moment its does.
//
// The analysis is pure and lives in `phelNsHygiene`; the path and namespace
// conventions in `phelNsPaths`.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { toZeroBasedRange } from './phelDiagnostics';
import { savedPhelDiagnostics } from './phelDiagnosticsProvider';
import { parseNsForm } from './phelNsAnalyzer';
import { findUnusedRequires, type NsHygieneIssue } from './phelNsHygiene';
import {
    DEFAULT_SRC_DIRS,
    DEFAULT_TEST_DIRS,
    deriveNamespace,
    pathToNs,
    sourceFileFor,
    testFileFor,
    testFileTemplate,
    type PhelFile,
} from './phelNsPaths';
import type { PhelProjectConfig } from './phelProjectConfig';
import type { PhelProjectConfigProvider } from './phelProjectConfigProvider';

const MAX_CHARS = 200_000;
const DEBOUNCE_MS = 250;

/** Marks a diagnostic as ours, so the quick fix can recognise it. */
export const NS_HYGIENE_CODE = 'phel-unused-require';
/** What `phel lint` calls the same finding, which supersedes ours after a save. */
export const LINT_UNUSED_REQUIRE_CODE = 'phel/unused-require';

/** The project layout a folder follows, defaulted for a project with no CLI. */
interface Layout {
    srcDirs: readonly string[];
    testDirs: readonly string[];
}

/** The argument `phel.ns.goToTest` accepts, e.g. from a keybinding's `args`. */
export interface GoToTestOptions {
    /** Scaffold a missing test file straight away, instead of offering to. */
    create?: boolean;
}

/** How many neighbouring files `deriveNamespace` is shown. */
const MAX_SIBLINGS = 8;

/** True when the user has not turned the automatic `(ns ...)` insert off. */
function autoInsertEnabled(): boolean {
    return vscode.workspace.getConfiguration('phel').get<boolean>('ns.autoInsert', true);
}

export class PhelNsHygiene implements vscode.Disposable {
    private readonly collection = vscode.languages.createDiagnosticCollection('phel-ns');
    private readonly subs: vscode.Disposable[] = [];
    private readonly timers = new Map<string, NodeJS.Timeout>();
    /** What was last published per uri, so a refresh that changes nothing is silent. */
    private readonly published = new Map<string, string>();
    /** Documents an insert is already in flight for; both triggers can fire. */
    private readonly inserting = new Set<string>();

    constructor(private readonly projectConfig?: PhelProjectConfigProvider) {
        this.subs.push(
            vscode.commands.registerCommand('phel.ns.goToTest', (options?: GoToTestOptions) =>
                this.goToCounterpart(options)
            ),
            vscode.workspace.onDidOpenTextDocument((doc) => {
                this.schedule(doc);
                void this.insertNamespace(doc);
            }),
            vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document)),
            vscode.workspace.onDidCreateFiles((e) => {
                for (const uri of e.files) {
                    void this.insertNamespaceAt(uri);
                }
            }),
            vscode.workspace.onDidCloseTextDocument((doc) => {
                this.collection.delete(doc.uri);
                this.published.delete(doc.uri.toString());
                this.cancel(doc.uri.toString());
            }),
            // `phel lint` reporting the same entry is what retires our hint, and
            // it arrives on its own schedule after a save.
            vscode.languages.onDidChangeDiagnostics((e) => {
                for (const uri of e.uris) {
                    const doc = openDocument(uri);
                    if (doc) {
                        this.schedule(doc);
                    }
                }
            })
        );
        for (const doc of vscode.workspace.textDocuments) {
            this.refresh(doc);
        }
    }

    dispose(): void {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
        this.collection.dispose();
        for (const sub of this.subs) {
            sub.dispose();
        }
    }

    private cancel(key: string): void {
        const timer = this.timers.get(key);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(key);
        }
    }

    private schedule(doc: vscode.TextDocument): void {
        if (doc.languageId !== 'phel') {
            return;
        }
        const key = doc.uri.toString();
        this.cancel(key);
        this.timers.set(
            key,
            setTimeout(() => {
                this.timers.delete(key);
                this.refresh(doc);
            }, DEBOUNCE_MS)
        );
    }

    private refresh(doc: vscode.TextDocument): void {
        if (doc.languageId !== 'phel') {
            return;
        }
        const src = doc.getText();
        if (src.length > MAX_CHARS) {
            // Too large to analyse on every change; clear stale results.
            this.publish(doc.uri, []);
            return;
        }
        const reported = lintUnusedRequireRanges(doc);
        const diags = findUnusedRequires(src)
            .map((issue) => ({ issue, range: rangeOf(doc, issue) }))
            .filter(({ range }) => !reported.some((other) => !!other.intersection(range)))
            .map(({ issue, range }) => {
                const diag = new vscode.Diagnostic(
                    range,
                    issue.message,
                    vscode.DiagnosticSeverity.Hint
                );
                diag.tags = [vscode.DiagnosticTag.Unnecessary];
                diag.source = 'phel';
                diag.code = NS_HYGIENE_CODE;
                return diag;
            });
        this.publish(doc.uri, diags);
    }

    /**
     * Publish only when something changed. `onDidChangeDiagnostics` is one of
     * the triggers above, so a collection that re-sets an identical value would
     * wake itself up for as long as the editor let it.
     */
    private publish(uri: vscode.Uri, diags: vscode.Diagnostic[]): void {
        const key = uri.toString();
        const signature = diags.map((d) => `${rangeKey(d.range)}:${d.message}`).join('|');
        if (this.published.get(key) === signature) {
            return;
        }
        this.published.set(key, signature);
        this.collection.set(uri, diags);
    }

    private async insertNamespaceAt(uri: vscode.Uri): Promise<void> {
        if (!uri.fsPath.endsWith('.phel') || uri.scheme !== 'file') {
            return;
        }
        try {
            await this.insertNamespace(await vscode.workspace.openTextDocument(uri));
        } catch {
            // Created and removed again, or not readable; nothing to scaffold.
        }
    }

    /**
     * Give a freshly created, still empty `.phel` file its `(ns ...)` form.
     *
     * Only a truly empty document qualifies: anything already in the buffer is
     * the user's, and a file that has a form in it may well have deleted its
     * `(ns ...)` on purpose.
     */
    private async insertNamespace(doc: vscode.TextDocument): Promise<void> {
        const key = doc.uri.toString();
        if (
            doc.languageId !== 'phel' ||
            doc.uri.scheme !== 'file' ||
            doc.getText().length > 0 ||
            !autoInsertEnabled() ||
            this.inserting.has(key)
        ) {
            return;
        }
        const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
        if (!folder) {
            return;
        }
        this.inserting.add(key);
        try {
            const relPath = relativePath(folder, doc.uri);
            const layout = this.layout(folder, false);
            const ns = deriveNamespace({
                relPath,
                siblings: await this.siblings(folder, relPath),
                ...layout,
            });
            // Both triggers race, and reading the siblings took a turn of the
            // event loop; anything typed meanwhile wins.
            if (!ns || doc.getText().length > 0) {
                return;
            }
            const edit = new vscode.WorkspaceEdit();
            edit.insert(doc.uri, new vscode.Position(0, 0), `(ns ${ns})\n\n`);
            await vscode.workspace.applyEdit(edit);
        } finally {
            this.inserting.delete(key);
        }
    }

    /** Open the test file of the current source file, or the other way round. */
    private async goToCounterpart(options?: GoToTestOptions): Promise<void> {
        const doc = vscode.window.activeTextEditor?.document;
        if (!doc || doc.languageId !== 'phel' || doc.uri.scheme !== 'file') {
            void vscode.window.showWarningMessage('Phel: open a .phel file first.');
            return;
        }
        const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
        if (!folder) {
            void vscode.window.showWarningMessage('Phel: this file is outside every folder.');
            return;
        }
        const layout = await this.layout(folder, true);
        const relPath = relativePath(folder, doc.uri);
        const here: PhelFile = {
            relPath,
            ns: parseNsForm(doc.getText())?.name || pathToNs(relPath),
        };
        // A root layout lists `.` among its src-dirs, which covers the test
        // directory too, so ask "is this already a test?" first.
        const source = sourceFileFor(here, layout.srcDirs, layout.testDirs);
        const counterpart = source ?? testFileFor(here, layout.srcDirs, layout.testDirs);
        if (!counterpart) {
            void vscode.window.showInformationMessage(
                `Phel: ${relPath} is under neither the project's src-dirs nor its test-dirs.`
            );
            return;
        }
        const target = vscode.Uri.joinPath(folder.uri, ...counterpart.relPath.split('/'));
        if (await exists(target)) {
            await show(target);
            return;
        }
        if (source) {
            // Scaffolding a *source* file from a test would be guesswork: the
            // test says what it wants to call, not what the file should hold.
            void vscode.window.showInformationMessage(
                `Phel: no ${counterpart.relPath} for ${here.ns}.`
            );
            return;
        }
        if (options?.create !== true) {
            const choice = await vscode.window.showInformationMessage(
                `Phel: no test file for ${here.ns}. Create ${counterpart.relPath}?`,
                'Create'
            );
            if (choice !== 'Create') {
                return;
            }
        }
        const testNs = counterpart.ns || `${here.ns}-test`;
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
        await vscode.workspace.fs.writeFile(
            target,
            new TextEncoder().encode(testFileTemplate(testNs, here.ns))
        );
        await show(target);
    }

    /**
     * The folder's `src-dirs` / `test-dirs`, defaulted to Phel's own layout.
     * `wait` decides whether a first answer is worth a PHP boot: an explicit
     * command can afford one, opening a file cannot.
     */
    private layout(folder: vscode.WorkspaceFolder, wait: true): Promise<Layout>;
    private layout(folder: vscode.WorkspaceFolder, wait: false): Layout;
    private layout(folder: vscode.WorkspaceFolder, wait: boolean): Layout | Promise<Layout> {
        if (wait) {
            return this.projectConfig
                ? this.projectConfig.get(folder).then(toLayout)
                : Promise.resolve(toLayout(null));
        }
        const known = this.projectConfig?.peek(folder);
        if (known === undefined) {
            void this.projectConfig?.get(folder); // for the next caller
        }
        return toLayout(known ?? null);
    }

    /**
     * The `.phel` files nearest `relPath` in the same folder, with the
     * namespace each declares. Nearest by shared directories: the file next
     * door is the one that knows how this project maps paths to namespaces.
     */
    private async siblings(folder: vscode.WorkspaceFolder, relPath: string): Promise<PhelFile[]> {
        const found = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, '**/*.phel'),
            '**/{node_modules,vendor}/**',
            500
        );
        const here = relPath.split('/');
        const nearest = found
            .map((uri) => relativePath(folder, uri))
            .filter((rel) => rel !== relPath)
            .sort((a, b) => sharedSegments(b.split('/'), here) - sharedSegments(a.split('/'), here))
            .slice(0, MAX_SIBLINGS);

        const out: PhelFile[] = [];
        for (const rel of nearest) {
            const uri = vscode.Uri.joinPath(folder.uri, ...rel.split('/'));
            try {
                const bytes = await vscode.workspace.fs.readFile(uri);
                const ns = parseNsForm(new TextDecoder().decode(bytes))?.name;
                if (ns) {
                    out.push({ relPath: rel, ns });
                }
            } catch {
                // Unreadable between the glob and the read; the others still say enough.
            }
        }
        return out;
    }
}

function toLayout(config: PhelProjectConfig | null): Layout {
    return {
        srcDirs: config?.srcDirs.length ? config.srcDirs : DEFAULT_SRC_DIRS,
        testDirs: config?.testDirs.length ? config.testDirs : DEFAULT_TEST_DIRS,
    };
}

function rangeOf(doc: vscode.TextDocument, issue: NsHygieneIssue): vscode.Range {
    return new vscode.Range(doc.positionAt(issue.start), doc.positionAt(issue.end));
}

function rangeKey(range: vscode.Range): string {
    return `${range.start.line},${range.start.character}-${range.end.line},${range.end.character}`;
}

/** Where `phel lint` already reported an unused require in this document. */
function lintUnusedRequireRanges(doc: vscode.TextDocument): vscode.Range[] {
    return savedPhelDiagnostics(doc.uri)
        .filter((diag) => diag.code === LINT_UNUSED_REQUIRE_CODE)
        .map((diag) => {
            const r = toZeroBasedRange(diag);
            return new vscode.Range(r.startLine, r.startCol, r.endLine, r.endCol);
        });
}

function openDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
    const key = uri.toString();
    return vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === key);
}

function relativePath(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string {
    return path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join('/');
}

/** How many leading segments two paths agree on. */
function sharedSegments(a: readonly string[], b: readonly string[]): number {
    let n = 0;
    while (n < a.length - 1 && n < b.length - 1 && a[n] === b[n]) {
        n++;
    }
    return n;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

async function show(uri: vscode.Uri): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
}
