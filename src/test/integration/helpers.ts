// Shared plumbing for the integration suites: activating the extension,
// resolving fixture paths, and waiting for the parts of the extension that
// finish on their own schedule (the workspace index scan, the 250 ms
// diagnostic debounces).
//
// Nothing here sleeps a fixed amount. The index and the debounced passes take
// wildly different times on a loaded CI runner than on a laptop, so a sleep is
// either slow or flaky; `waitFor` polls against a deadline instead.

import * as path from 'path';
import * as vscode from 'vscode';

export const EXTENSION_ID = 'Phel-Lang.phel-lang';

/** The fixture workspace VS Code was launched with (`test-fixtures/workspace`). */
export const WORKSPACE_ROOT = path.resolve(__dirname, '../../../test-fixtures/workspace');

export function fixtureUri(...segments: string[]): vscode.Uri {
    return vscode.Uri.file(path.join(WORKSPACE_ROOT, ...segments));
}

/** Activate the extension. Idempotent, so every suite calls it from `before`. */
export async function activateExtension(): Promise<vscode.Extension<unknown>> {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    if (!extension) {
        throw new Error(`extension ${EXTENSION_ID} is not installed in the test host`);
    }
    await extension.activate();
    return extension;
}

/** Open a fixture file and show it, so editor-scoped commands have a target. */
export async function openFixture(...segments: string[]): Promise<vscode.TextDocument> {
    const doc = await vscode.workspace.openTextDocument(fixtureUri(...segments));
    await vscode.window.showTextDocument(doc, { preview: false });
    return doc;
}

/**
 * Position of `needle` in `doc`, `shift` characters in. Fixtures are addressed
 * by their text rather than by line/column so editing one does not silently
 * move every assertion off its target.
 */
export function positionOf(doc: vscode.TextDocument, needle: string, shift = 0): vscode.Position {
    const at = doc.getText().indexOf(needle);
    if (at < 0) {
        throw new Error(`${doc.uri.fsPath} does not contain ${JSON.stringify(needle)}`);
    }
    return doc.positionAt(at + shift);
}

/**
 * Poll `probe` until it returns something other than `undefined`, or fail with
 * `what` in the message. The things we wait for have no completion event a test
 * could subscribe to.
 */
export async function waitFor<T>(
    what: string,
    probe: () => T | undefined | Promise<T | undefined>,
    timeoutMs = 15_000
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    for (;;) {
        try {
            const value = await probe();
            if (value !== undefined) {
                return value;
            }
        } catch (err) {
            lastError = err;
        }
        if (Date.now() >= deadline) {
            const detail = lastError instanceof Error ? ` (last error: ${lastError.message})` : '';
            throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}${detail}`);
        }
        await delay(100);
    }
}

export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Completion labels are either a string or a `{ label }` record. */
export function labelOf(item: vscode.CompletionItem): string {
    return typeof item.label === 'string' ? item.label : item.label.label;
}
