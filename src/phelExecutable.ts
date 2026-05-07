import * as vscode from 'vscode';
import { resolveExecutablePath } from './phelExecutablePath';

const FALLBACK_KEY = 'executablePath';

export type PhelExecutableSubsystem =
    | 'diagnostics.command'
    | 'format.command'
    | 'test.command'
    | 'repl.command';

const SUBSYSTEM_KEYS: readonly PhelExecutableSubsystem[] = [
    'diagnostics.command',
    'format.command',
    'test.command',
    'repl.command',
];

export const PHEL_EXECUTABLE_SETTINGS: readonly string[] = [
    `phel.${FALLBACK_KEY}`,
    ...SUBSYSTEM_KEYS.map((k) => `phel.${k}`),
];

/**
 * Resolves the Phel CLI path for a given subsystem.
 *
 * Precedence: per-command override (`phel.<subsystem>`) → workspace fallback
 * (`phel.executablePath`) → built-in default (`vendor/bin/phel`).
 */
export function resolvePhelExecutable(
    subsystem: PhelExecutableSubsystem,
    folder: vscode.WorkspaceFolder | undefined
): string {
    const config = vscode.workspace.getConfiguration('phel', folder);
    const cwd = folder?.uri.fsPath ?? process.cwd();
    return resolveExecutablePath(
        explicitString(config, subsystem),
        explicitString(config, FALLBACK_KEY),
        cwd
    );
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
