import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { buildFormatEdits } from './phelFormat';
import { resolvePhelExecutable } from './phelExecutable';

export class PhelFormatProvider implements vscode.DocumentFormattingEditProvider {
    async provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        _options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): Promise<vscode.TextEdit[]> {
        if (!isEnabled()) {
            return [];
        }
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        const command = resolvePhelExecutable('format.command', folder);

        const original = document.getText();
        try {
            const formatted = await formatViaCli(command, original);
            if (token.isCancellationRequested) {
                return [];
            }
            const edits = buildFormatEdits(original, formatted);
            return edits.map(
                (e) =>
                    new vscode.TextEdit(
                        new vscode.Range(
                            new vscode.Position(e.range.startLine, e.range.startCol),
                            new vscode.Position(e.range.endLine, e.range.endCol)
                        ),
                        e.newText
                    )
            );
        } catch (err) {
            console.error('phel format failed:', err);
            return [];
        }
    }
}

function isEnabled(): boolean {
    return vscode.workspace.getConfiguration('phel').get<boolean>('format.enabled', true);
}

/**
 * `phel format` only edits files in place, so we round-trip through a temp
 * file. The buffer is written, formatted, then read back. The temp file is
 * always cleaned up.
 */
async function formatViaCli(command: string, source: string): Promise<string> {
    const tmp = path.join(os.tmpdir(), `phel-fmt-${process.pid}-${Date.now()}.phel`);
    await fs.writeFile(tmp, source, 'utf-8');
    try {
        await new Promise<void>((resolve, reject) => {
            execFile(command, ['format', tmp], { maxBuffer: 8 * 1024 * 1024 }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
        return await fs.readFile(tmp, 'utf-8');
    } finally {
        await fs.unlink(tmp).catch(() => undefined);
    }
}
