import * as path from 'node:path';
import * as vscode from 'vscode';

const DEFAULT_EXECUTABLE = 'vendor/bin/phel';

export const PHEL_EXECUTABLE_SETTINGS = [
    'phel.executablePath',
    'phel.diagnostics.command',
    'phel.format.command',
    'phel.test.command',
    'phel.repl.command',
] as const;

/**
 * Resolves the Phel CLI path for a given subsystem.
 *
 * Precedence: per-command override (`phel.<key>`) → workspace fallback
 * (`phel.executablePath`) → built-in default (`vendor/bin/phel`).
 * Relative paths resolve against `cwd`.
 */
export function resolvePhelExecutable(
    perCommandKey: string,
    folder: vscode.WorkspaceFolder | undefined
): string {
    const config = vscode.workspace.getConfiguration('phel', folder);
    const explicit = explicitString(config, perCommandKey);
    const fallback = explicitString(config, 'executablePath') ?? DEFAULT_EXECUTABLE;
    const cmd = explicit ?? fallback;
    const cwd = folder?.uri.fsPath ?? process.cwd();
    return path.isAbsolute(cmd) ? cmd : path.join(cwd, cmd);
}

function explicitString(config: vscode.WorkspaceConfiguration, key: string): string | undefined {
    const inspected = config.inspect<string>(key);
    const value =
        inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function affectsPhelExecutable(e: vscode.ConfigurationChangeEvent): boolean {
    return PHEL_EXECUTABLE_SETTINGS.some((key) => e.affectsConfiguration(key));
}
