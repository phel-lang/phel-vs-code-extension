// Status-bar item that shows the current Phel namespace (when editing a
// `.phel` file) and a "Phel" indicator otherwise, followed by one icon per Phel
// process that is up: `$(pulse)` for the analysis daemon, `$(plug)` for an
// nREPL connection, `$(server)` for the language server. What those icons say
// comes from `phelRuntimeState`, which every subsystem publishes into.
//
// Clicking it opens the action list (`phel.status.actions`) rather than
// starting a REPL: with three processes behind the icons, "the one thing you
// want from here" is no longer a single command.
//
// Project detection scans each workspace folder's `composer.json` once at
// activation and updates if the file changes; we don't need to be live for
// every keystroke.

import * as vscode from 'vscode';
import { phelAnalysisOutput } from './phelDaemonDiagnosticsProvider';
import { parseNsForm } from './phelNsAnalyzer';
import { analyzeComposerJson, type PhelProjectInfo } from './phelProject';
import {
    isDaemonUp,
    isLspUp,
    isNreplUp,
    phelRuntimeState,
    type PhelRuntimeSnapshot,
    renderStatusText,
    renderStatusTooltip,
    stateFor,
} from './phelRuntimeState';
import { activeWorkspaceFolder } from './phelWorkspace';

const COMPOSER_PATH = 'composer.json';

/** A quick-pick entry that knows what it does. */
interface StatusAction extends vscode.QuickPickItem {
    run: () => void | Thenable<unknown>;
}

export interface PhelStatusBarOptions {
    /**
     * Restart the language server. Passed in because the client ships as its
     * own bundle and only `extension.ts` may load it; `undefined` leaves the
     * entry out of the action list.
     */
    restartLanguageServer?: () => Promise<void>;
}

export class PhelStatusBar implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly projects = new Map<string, PhelProjectInfo>();

    constructor(private readonly options: PhelStatusBarOptions = {}) {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.command = 'phel.status.actions';
        this.disposables.push(this.item);
    }

    async start(context: vscode.ExtensionContext): Promise<void> {
        context.subscriptions.push(this);
        // Registered before the first `await`, so the commands exist as soon as
        // `activate` returns rather than one composer.json read later.
        this.disposables.push(
            vscode.commands.registerCommand('phel.status.actions', () => this.showActions()),
            vscode.commands.registerCommand('phel.status.describe', () =>
                phelRuntimeState.snapshot()
            ),
            new vscode.Disposable(phelRuntimeState.onDidChange(() => this.update()))
        );
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
        const snapshot = phelRuntimeState.snapshot();
        const editor = vscode.window.activeTextEditor;
        if (editor?.document.languageId === 'phel') {
            const ns = parseNsForm(editor.document.getText());
            const folderKey = vscode.workspace
                .getWorkspaceFolder(editor.document.uri)
                ?.uri.toString();
            this.item.text = renderStatusText(ns?.name, snapshot, folderKey);
            this.item.tooltip = this.tooltip(
                ns ? `Phel namespace: ${ns.name}` : 'Phel file (no ns form).',
                snapshot
            );
            this.item.show();
            return;
        }
        if (this.projects.size > 0) {
            const versions = [...this.projects.values()]
                .map((p) => p.version ?? '')
                .filter(Boolean);
            this.item.text = renderStatusText(undefined, snapshot);
            this.item.tooltip = this.tooltip(
                versions.length ? `Phel project (${versions.join(', ')}).` : 'Phel project.',
                snapshot
            );
            this.item.show();
            return;
        }
        this.item.hide();
    }

    private tooltip(headline: string, snapshot: PhelRuntimeSnapshot): string {
        return [headline, renderStatusTooltip(snapshot), 'Click for Phel actions.'].join('\n');
    }

    /** The click target: everything you can do to the processes behind the icons. */
    private async showActions(): Promise<void> {
        const snapshot = phelRuntimeState.snapshot();
        const folderKey = activeWorkspaceFolder()?.uri.toString();
        const nrepl = stateFor(snapshot.nrepl, folderKey, isNreplUp) ?? 'disconnected';
        const daemon = stateFor(snapshot.daemon, folderKey, isDaemonUp) ?? 'off';

        const actions: StatusAction[] = [
            {
                label: '$(terminal) Start REPL',
                run: () => vscode.commands.executeCommand('phel.repl.start'),
            },
            isNreplUp(nrepl)
                ? {
                      label: '$(debug-disconnect) Disconnect from the nREPL server',
                      description: nrepl,
                      run: () => vscode.commands.executeCommand('phel.nrepl.disconnect'),
                  }
                : {
                      label: '$(plug) Connect to the nREPL server',
                      description: nrepl,
                      run: () => vscode.commands.executeCommand('phel.nrepl.connect'),
                  },
            {
                label: '$(refresh) Restart the analysis daemon',
                description: daemon,
                run: () => vscode.commands.executeCommand('phel.diagnostics.restartDaemon'),
            },
        ];
        const restart = this.options.restartLanguageServer;
        const lspEnabled = vscode.workspace
            .getConfiguration('phel')
            .get<boolean>('lsp.enabled', false);
        if (restart && lspEnabled) {
            actions.push({
                label: '$(server) Restart the language server',
                description: stateFor(snapshot.lsp, folderKey, isLspUp) ?? 'disabled',
                run: () => restart(),
            });
        }
        actions.push(
            {
                label: '$(output) Show the Phel Analysis output',
                run: () => phelAnalysisOutput().show(true),
            },
            {
                label: '$(checklist) Run doctor',
                run: () => vscode.commands.executeCommand('phel.doctor'),
            }
        );

        const picked = await vscode.window.showQuickPick(actions, {
            title: 'Phel',
            placeHolder: 'Pick an action',
        });
        await picked?.run();
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
