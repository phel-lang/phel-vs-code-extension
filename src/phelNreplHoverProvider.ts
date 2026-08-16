// Hover evaluation against the live runtime: while an nREPL connection is open
// for the document's folder, hovering a symbol shows what it evaluates to right
// now, below the documentation hover.
//
// Two rules keep it unsurprising. It never opens a connection — hover is
// passive, and starting a `phel nrepl` server because the mouse crossed a
// symbol would be a rude way to find out about this feature. And it only ever
// evaluates a *symbol* (`hoverEvalCandidate` decides), never the form around
// it, so a hover cannot run anyone's code. An eval that outlives the hover is
// abandoned and the session interrupted; nothing is shown for it.

import * as vscode from 'vscode';
import { hoverEvalCandidate } from './phelHoverEval';
import { isErrorResult, type PhelNreplConnection } from './phelNreplClient';
import { parseNsForm } from './phelNsAnalyzer';
import { PHEL_SYMBOL_RE } from './phelSymbolToken';
import { folderForDocument } from './phelWorkspace';

/** A hover has to feel instant; a slower eval is not worth waiting for. */
const EVAL_TIMEOUT_MS = 2000;
/** Long values are for the output channel; the hover shows the shape. */
const MAX_VALUE_CHARS = 300;

type PeekConnection = (folder: vscode.WorkspaceFolder) => PhelNreplConnection | undefined;

export class PhelNreplHoverProvider implements vscode.HoverProvider {
    /** Injected rather than imported, to keep this file out of the provider's own import cycle. */
    constructor(private readonly peek: PeekConnection) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        const folder = folderForDocument(document);
        if (!folder) {
            return null;
        }
        const enabled = vscode.workspace
            .getConfiguration('phel', folder)
            .get<boolean>('nrepl.hoverEval', true);
        if (!enabled) {
            return null;
        }
        const conn = this.peek(folder);
        if (!conn) {
            return null;
        }
        const range = document.getWordRangeAtPosition(position, PHEL_SYMBOL_RE);
        if (!range) {
            return null;
        }
        const symbol = hoverEvalCandidate(document.getText(), document.offsetAt(position));
        if (!symbol) {
            return null;
        }

        const ns = parseNsForm(document.getText())?.name ?? undefined;
        let result;
        try {
            result = await conn.eval(symbol, ns, EVAL_TIMEOUT_MS);
        } catch {
            // Timed out, or the connection went away mid-hover. Tell the server
            // to drop the op and show nothing: a hover is not the place to
            // report that the runtime is busy.
            void conn.interrupt().then(undefined, () => undefined);
            return null;
        }
        if (token.isCancellationRequested || isErrorResult(result) || result.values.length === 0) {
            // An undefined symbol, a namespace that is not loaded, a form that
            // threw — all normal while editing, and none of them a hover.
            return null;
        }

        const md = new vscode.MarkdownString();
        md.appendCodeblock(`=> ${truncate(result.values.join('\n'))}`, 'phel');
        return new vscode.Hover(md, range);
    }
}

function truncate(value: string, max = MAX_VALUE_CHARS): string {
    return value.length > max ? value.slice(0, max - 1) + '…' : value;
}
