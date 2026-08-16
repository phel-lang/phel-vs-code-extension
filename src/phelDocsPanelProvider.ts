// The editor side of the docs panel: one webview per window, reused by every
// `Phel: Show Documentation`.
//
// One panel rather than one per symbol, because the panel *is* the corpus - a
// second tab would hold the same ~900 symbols with a different row selected.
// `retainContextWhenHidden` stays off for the same reason: rebuilding the page
// is one `renderDocsPanelHtml` call, which is cheaper than keeping a hidden
// renderer process alive for it.
//
// Nothing is loaded from disk (`localResourceRoots: []`), so the page can only
// ever be what `phelDocsPanel` rendered, under a nonce that changes with it.

import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { PHEL_DOCS } from './phelCoreDocs';
import type { PhelDoc } from './phelDocs';
import {
    type DocsPanelEntry,
    buildDocsPayload,
    renderDetailHtml,
    renderDocsPanelHtml,
} from './phelDocsPanel';
import { lookupSymbol } from './phelDocsLookup';

const VIEW_TYPE = 'phel.docs';
const TITLE = 'Phel API';

export class PhelDocsPanel implements vscode.Disposable {
    private panel?: vscode.WebviewPanel;
    private payload?: DocsPanelEntry[];
    private readonly subs: vscode.Disposable[] = [];

    constructor() {
        // Reloading the window brings the tab back, and a webview with no
        // serializer comes back broken. Nothing is worth persisting - the page
        // is one render away - so the restored panel is simply re-rendered.
        this.subs.push(
            vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
                deserializeWebviewPanel: (panel) => {
                    this.adopt(panel);
                    return Promise.resolve();
                },
            })
        );
    }

    /**
     * Show `selected` in the panel, opening one if there is none. Answers
     * `false` when this editor cannot host a webview at all, which is the
     * caller's cue to fall back to the Markdown preview.
     */
    show(selected?: PhelDoc): boolean {
        const panel = this.ensurePanel();
        if (!panel) {
            return false;
        }
        this.render(panel, selected);
        panel.reveal(panel.viewColumn);
        return true;
    }

    dispose(): void {
        for (const sub of this.subs) {
            sub.dispose();
        }
        this.subs.length = 0;
        this.panel?.dispose();
        this.panel = undefined;
    }

    private ensurePanel(): vscode.WebviewPanel | undefined {
        if (this.panel) {
            return this.panel;
        }
        let panel: vscode.WebviewPanel;
        try {
            panel = vscode.window.createWebviewPanel(VIEW_TYPE, TITLE, vscode.ViewColumn.Beside, {
                enableScripts: true,
                retainContextWhenHidden: false,
                localResourceRoots: [],
            });
        } catch {
            // No webview host (some remote / restricted windows). The command
            // still has a way to show a doc, so this is not worth a message.
            return undefined;
        }
        this.attach(panel);
        return panel;
    }

    /** Take over a panel VS Code restored, and put a page back into it. */
    private adopt(panel: vscode.WebviewPanel): void {
        if (this.panel) {
            // A window cannot restore two of these, but if it did, the one this
            // instance already drives is the one to keep.
            panel.dispose();
            return;
        }
        panel.webview.options = { enableScripts: true, localResourceRoots: [] };
        this.attach(panel);
        this.render(panel);
    }

    private attach(panel: vscode.WebviewPanel): void {
        panel.onDidDispose(() => {
            this.panel = undefined;
        });
        // The page ships every symbol's name and signature, but not the example,
        // see-also list and source link: rendering ~900 detail panes up front to
        // read one is what this message avoids.
        panel.webview.onDidReceiveMessage((message: { type?: string; qualifiedName?: string }) => {
            if (message?.type !== 'select' || typeof message.qualifiedName !== 'string') {
                return;
            }
            const doc = lookupSymbol(message.qualifiedName, PHEL_DOCS);
            void panel.webview.postMessage({
                type: 'detail',
                qualifiedName: message.qualifiedName,
                html: doc ? renderDetailHtml(doc) : '',
            });
        });
        this.panel = panel;
    }

    private render(panel: vscode.WebviewPanel, selected?: PhelDoc): void {
        panel.webview.html = renderDocsPanelHtml(
            { query: selected?.name ?? '', results: this.entries(), selected },
            randomBytes(16).toString('base64')
        );
    }

    /** The search index, built once: the corpus does not change in a session. */
    private entries(): DocsPanelEntry[] {
        this.payload ??= buildDocsPayload(PHEL_DOCS);
        return this.payload;
    }
}
