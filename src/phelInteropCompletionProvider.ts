// The second completion provider: the PHP half, answered by `phel api-daemon`.
//
// It is registered alongside `PhelCompletionProvider` rather than folded into
// it. VS Code asks every provider registered for the language and merges what
// they return, so the two stay independent: this one contributes nothing
// outside a PHP-interop position, and everything it does contribute needs a
// warm PHP process the other one must never wait for.
//
// Which is the whole design here. Completion runs on the keystroke path, so the
// daemon gets a 400 ms budget and whatever has not arrived by then is dropped -
// the popup shows the bundled items, exactly as before this existed. The list
// is returned as incomplete, so the next keystroke asks again and a daemon that
// was still booting gets another chance.

import * as vscode from 'vscode';
import type { DaemonCompletion, InteropItemKind } from './phelInteropCompletion';
import {
    isInteropCompletionPosition,
    replacedTokenLength,
    toCompletionSpecs,
} from './phelInteropCompletion';
import { plainMarkdown } from './phelProviderSupport';
import type { PhelDaemonSource } from './phelWorkspaceIndexProvider';

/** What the daemon has ready by then; a slower answer is for the next keystroke. */
const RESPONSE_BUDGET_MS = 400;

const KINDS: Record<InteropItemKind, vscode.CompletionItemKind> = {
    method: vscode.CompletionItemKind.Method,
    function: vscode.CompletionItemKind.Function,
    class: vscode.CompletionItemKind.Class,
    property: vscode.CompletionItemKind.Property,
    constant: vscode.CompletionItemKind.Constant,
    variable: vscode.CompletionItemKind.Variable,
};

export class PhelInteropCompletionProvider implements vscode.CompletionItemProvider {
    /**
     * The daemon owner, `PhelDaemonDiagnostics` - the same process live
     * diagnostics and the project index use. One PHP interpreter per workspace
     * folder is enough for all three.
     */
    constructor(private readonly daemons: PhelDaemonSource) {}

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionList | undefined> {
        const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
        if (!isEnabled(document) || !isInteropCompletionPosition(linePrefix)) {
            return undefined;
        }
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        // No project root means no `phel-config.php`, and nothing to reflect over.
        const client = folder ? this.daemons.daemonFor(folder) : undefined;
        if (!client) {
            return undefined;
        }

        const answered = await this.race(
            client.completeAtPoint(
                document.getText(),
                // The daemon counts both from 1, the column as "characters
                // before the cursor, plus one".
                position.line + 1,
                position.character + 1,
                // Keyed per document, so the requests a burst of keystrokes
                // makes coalesce into the one asking about the newest buffer.
                `${document.uri.toString()}:completion`
            ),
            token
        );

        const range = new vscode.Range(
            position.translate(0, -replacedTokenLength(linePrefix)),
            position
        );
        const items = toCompletionSpecs(answered).map((spec) => {
            const item = new vscode.CompletionItem(spec.label, KINDS[spec.kind]);
            item.detail = spec.detail;
            if (spec.documentation) {
                item.documentation = plainMarkdown(spec.documentation);
            }
            if (spec.insertText) {
                item.insertText = spec.insertText;
            }
            item.sortText = spec.sortText;
            // The `phel` word pattern would swallow the `php/` prefix this item
            // was offered for, so say what it replaces.
            item.range = range;
            return item;
        });
        // Incomplete on purpose: an empty answer here is usually "the daemon is
        // still booting", and only a re-request can improve on it.
        return new vscode.CompletionList(items, true);
    }

    /**
     * `answer`, or nothing once the budget is spent or the editor has moved on.
     * A daemon that is busy, dead or too old for `completeAtPoint` rejects,
     * which is the same non-answer.
     */
    private race(
        answer: Promise<DaemonCompletion[]>,
        token: vscode.CancellationToken
    ): Promise<DaemonCompletion[]> {
        // Caught here rather than at the await: the loser of the race settles
        // with nobody listening, and an unhandled rejection would take the
        // extension host's log with it.
        const answered = answer.catch((): DaemonCompletion[] => []);
        let timer: NodeJS.Timeout | undefined;
        let cancellation: vscode.Disposable | undefined;
        const gaveUp = new Promise<DaemonCompletion[]>((resolve) => {
            timer = setTimeout(() => resolve([]), RESPONSE_BUDGET_MS);
            cancellation = token.onCancellationRequested(() => resolve([]));
        });
        return Promise.race([answered, gaveUp]).finally(() => {
            clearTimeout(timer);
            cancellation?.dispose();
        });
    }
}

/** Folder-scoped: a project whose interop is not worth a PHP process can say so. */
function isEnabled(document: vscode.TextDocument): boolean {
    return vscode.workspace
        .getConfiguration('phel', document)
        .get<boolean>('completion.phpInterop', true);
}
