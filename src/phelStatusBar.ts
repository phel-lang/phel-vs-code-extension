// Status-bar item that shows the current Phel namespace (when editing a
// `.phel` file) and a "Phel" indicator otherwise. Clicking it runs
// `phel.repl.start` so the REPL is one click away.
//
// Project detection scans each workspace folder's `composer.json` once at
// activation and updates if the file changes; we don't need to be live for
// every keystroke.

import * as vscode from 'vscode';
import { parseNsForm } from './phelNsAnalyzer';
import { analyzeComposerJson, type PhelProjectInfo } from './phelProject';

const COMPOSER_PATH = 'composer.json';

export class PhelStatusBar implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly projects = new Map<string, PhelProjectInfo>();

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.command = 'phel.repl.start';
        this.disposables.push(this.item);
    }

    async start(context: vscode.ExtensionContext): Promise<void> {
        context.subscriptions.push(this);
        await this.refreshProjects();
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => this.update()),
            vscode.workspace.onDidChangeTextDocument((e) => {
                if (e.document === vscode.window.activeTextEditor?.document) {
                    this.update();
                }
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.refreshProjects()),
            vscode.workspace.onDidSaveTextDocument((doc) => {
                if (doc.uri.path.endsWith(`/${COMPOSER_PATH}`)) {
                    void this.refreshProjects();
                }
            })
        );
        this.update();
    }

    private async refreshProjects(): Promise<void> {
        this.projects.clear();
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            const uri = vscode.Uri.joinPath(folder.uri, COMPOSER_PATH);
            try {
                const bytes = await vscode.workspace.fs.readFile(uri);
                const info = analyzeComposerJson(Buffer.from(bytes).toString('utf-8'));
                if (info.isPhelProject) {
                    this.projects.set(folder.uri.fsPath, info);
                }
            } catch {
                // No composer.json — not a Phel project, leave map clean.
            }
        }
        this.update();
    }

    private update(): void {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document.languageId === 'phel') {
            const ns = parseNsForm(editor.document.getText());
            this.item.text = ns ? `$(symbol-namespace) ${ns.name}` : `$(symbol-namespace) Phel`;
            this.item.tooltip = ns
                ? `Phel namespace: ${ns.name}\nClick to start the REPL.`
                : 'Phel file (no ns form). Click to start the REPL.';
            this.item.show();
            return;
        }
        if (this.projects.size > 0) {
            const versions = [...this.projects.values()]
                .map((p) => p.version ?? '')
                .filter(Boolean);
            this.item.text = '$(symbol-namespace) Phel';
            this.item.tooltip = versions.length
                ? `Phel project (${versions.join(', ')}). Click to start the REPL.`
                : 'Phel project. Click to start the REPL.';
            this.item.show();
            return;
        }
        this.item.hide();
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
