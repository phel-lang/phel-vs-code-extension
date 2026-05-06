import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';
import { SourceMapManager } from './sourceMapManager';
import { PhelDebugSession } from './phelDebugAdapter';
import { PhelCompletionProvider } from './phelCompletionProvider';
import { PhelHoverProvider } from './phelHoverProvider';
import { PhelSignatureHelpProvider } from './phelSignatureHelpProvider';
import { PHEL_DOCS } from './phelCoreDocs';
import { lookupSymbol, renderDocMarkdown } from './phelDocsLookup';
import { buildQuickPickEntries } from './phelShowDoc';
import { registerDiagnostics } from './phelDiagnosticsProvider';
import { PhelFormatProvider } from './phelFormatProvider';

let sourceMapManager: SourceMapManager;

export function activate(context: vscode.ExtensionContext) {
    console.log('Phel extension activated');

    // Initialize source map manager
    sourceMapManager = new SourceMapManager();

    // Add workspace folders to source map manager
    if (vscode.workspace.workspaceFolders) {
        for (const folder of vscode.workspace.workspaceFolders) {
            sourceMapManager.addWorkspaceRoot(folder.uri.fsPath);
        }
    }

    // Register the debug adapter factory
    const factory = new PhelDebugAdapterFactory();
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('phel', factory));

    // Register debug configuration provider
    const configProvider = new PhelDebugConfigurationProvider();
    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider('phel', configProvider)
    );

    // Register command: Show compiled PHP location
    context.subscriptions.push(
        vscode.commands.registerCommand('phel.showCompiledLocation', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor');
                return;
            }

            const document = editor.document;
            if (!document.fileName.endsWith('.phel')) {
                vscode.window.showErrorMessage('Current file is not a Phel file');
                return;
            }

            const line = editor.selection.active.line + 1;
            const translation = sourceMapManager.translateToPhp(document.fileName, line);

            if (translation) {
                const message = `Line ${line} maps to:\n${translation.file}:${translation.line}`;

                const action = await vscode.window.showInformationMessage(
                    message,
                    'Open PHP File',
                    'Copy Path'
                );

                if (action === 'Open PHP File') {
                    const doc = await vscode.workspace.openTextDocument(translation.file);
                    const editor = await vscode.window.showTextDocument(doc);
                    const position = new vscode.Position(translation.line - 1, 0);
                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(new vscode.Range(position, position));
                } else if (action === 'Copy Path') {
                    await vscode.env.clipboard.writeText(`${translation.file}:${translation.line}`);
                    vscode.window.showInformationMessage('Copied to clipboard');
                }
            } else {
                vscode.window.showWarningMessage(
                    'Could not find compiled PHP file. Make sure the file has been compiled with source maps enabled.'
                );
            }
        })
    );

    // Register command: Clear source map cache
    context.subscriptions.push(
        vscode.commands.registerCommand('phel.clearSourceMapCache', () => {
            sourceMapManager.clearCache();
            vscode.window.showInformationMessage('Phel source map cache cleared');
        })
    );

    // Register command: Show Phel documentation
    context.subscriptions.push(
        vscode.commands.registerCommand('phel.showDoc', async (symbol?: string) => {
            await runShowDocCommand(symbol);
        })
    );

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('phel.cacheDirectory')) {
                const config = vscode.workspace.getConfiguration('phel');
                const cacheDir = config.get<string>('cacheDirectory');
                if (cacheDir) {
                    sourceMapManager.addCacheDirectory(cacheDir);
                }
            }
        })
    );

    // Apply initial configuration
    const config = vscode.workspace.getConfiguration('phel');
    const cacheDir = config.get<string>('cacheDirectory');
    if (cacheDir) {
        sourceMapManager.addCacheDirectory(cacheDir);
    }

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider('phel', new PhelCompletionProvider())
    );

    context.subscriptions.push(
        vscode.languages.registerHoverProvider('phel', new PhelHoverProvider())
    );

    context.subscriptions.push(
        vscode.languages.registerSignatureHelpProvider(
            'phel',
            new PhelSignatureHelpProvider(),
            '(',
            ' '
        )
    );

    registerDiagnostics(context);

    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider('phel', new PhelFormatProvider())
    );

    // Provide hover information for breakpoints
    context.subscriptions.push(
        vscode.languages.registerHoverProvider('phel', {
            provideHover(document, position, _token) {
                // Check if there's a breakpoint on this line
                const breakpoints = vscode.debug.breakpoints.filter(
                    (bp) =>
                        bp instanceof vscode.SourceBreakpoint &&
                        bp.location.uri.fsPath === document.fileName &&
                        bp.location.range.start.line === position.line
                );

                if (breakpoints.length > 0) {
                    const line = position.line + 1;
                    const translation = sourceMapManager.translateToPhp(document.fileName, line);

                    if (translation) {
                        return new vscode.Hover(
                            new vscode.MarkdownString(
                                `**Phel Breakpoint**\n\nMaps to: \`${path.basename(translation.file)}:${translation.line}\``
                            )
                        );
                    }
                }

                return null;
            },
        })
    );
}

export function deactivate() {
    // Cleanup
}

/**
 * Resolve a symbol (from arg, cursor, or quick-pick) and show its docs in
 * a Markdown preview tab.
 */
async function runShowDocCommand(symbolArg?: string): Promise<void> {
    let symbol = symbolArg ?? wordAtCursor();
    if (!symbol || !lookupSymbol(symbol, PHEL_DOCS)) {
        symbol = await pickSymbol();
        if (!symbol) {
            return;
        }
    }
    const doc = lookupSymbol(symbol, PHEL_DOCS);
    if (!doc) {
        vscode.window.showWarningMessage(`No Phel documentation found for "${symbol}".`);
        return;
    }
    const markdown = renderDocMarkdown(doc);
    const tdoc = await vscode.workspace.openTextDocument({
        content: markdown,
        language: 'markdown',
    });
    await vscode.commands.executeCommand('markdown.showPreview', tdoc.uri);
}

function wordAtCursor(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'phel') {
        return undefined;
    }
    const range = editor.document.getWordRangeAtPosition(
        editor.selection.active,
        /[A-Za-z0-9_!?*+<>=/\-.':$&%][^\s(){}[\]"',`]*/
    );
    return range ? editor.document.getText(range) : undefined;
}

async function pickSymbol(): Promise<string | undefined> {
    const entries = buildQuickPickEntries(PHEL_DOCS);
    const items = entries.map((e) => ({
        label: e.label,
        description: e.description,
        detail: e.detail,
        qualifiedName: e.doc.qualifiedName,
    }));
    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Phel symbol (start typing to filter)',
        matchOnDescription: true,
        matchOnDetail: true,
    });
    return picked?.qualifiedName;
}

/**
 * Debug adapter factory for Phel.
 */
class PhelDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    private server?: net.Server;

    createDebugAdapterDescriptor(
        _session: vscode.DebugSession,
        _executable: vscode.DebugAdapterExecutable | undefined
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        // Create an inline debug adapter
        return new vscode.DebugAdapterInlineImplementation(new PhelDebugSession());
    }

    dispose() {
        if (this.server) {
            this.server.close();
        }
    }
}

/**
 * Parse phel-config.php to extract configuration.
 * Looks for setTempDir() call to find the cache directory.
 */
function parsePhelConfig(configPath: string): { tempDir?: string } | null {
    try {
        if (!fs.existsSync(configPath)) {
            return null;
        }

        const content = fs.readFileSync(configPath, 'utf-8');
        const result: { tempDir?: string } = {};

        // Look for ->setTempDir('path') or ->setTempDir("path")
        const tempDirMatch = content.match(/->setTempDir\s*\(\s*['"]([^'"]+)['"]\s*\)/);
        if (tempDirMatch) {
            result.tempDir = tempDirMatch[1];
        }

        // Also check for sys_get_temp_dir() pattern
        if (content.includes('sys_get_temp_dir()') && content.includes('/phel')) {
            // Default Phel behavior: sys_get_temp_dir() . '/phel'
            result.tempDir = path.join(os.tmpdir(), 'phel');
        }

        return result;
    } catch {
        return null;
    }
}

/**
 * Debug configuration provider for Phel.
 */
class PhelDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        _token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        // If no configuration is provided, create a default one
        if (!config.type && !config.request && !config.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'phel') {
                config.type = 'phel';
                config.request = 'launch';
                config.name = 'Debug Phel';
                config.phpDebugPort = 9003;
            }
        }

        // Ensure we have a valid configuration
        if (!config.type) {
            return undefined;
        }

        // Set defaults
        config.phpDebugPort = config.phpDebugPort || 9003;

        // Try to auto-detect cache directory from phel-config.php
        if (!config.cacheDir && folder) {
            const configPath = path.join(folder.uri.fsPath, 'phel-config.php');
            const phelConfig = parsePhelConfig(configPath);

            if (phelConfig?.tempDir) {
                // Phel stores compiled files in {tempDir}/cache/compiled
                config.cacheDir = path.join(phelConfig.tempDir, 'cache', 'compiled');
            }
        }

        return config;
    }

    provideDebugConfigurations(
        _folder: vscode.WorkspaceFolder | undefined,
        _token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration[]> {
        return [
            {
                type: 'phel',
                request: 'launch',
                name: 'Debug Phel (Listen for Xdebug)',
                phpDebugPort: 9003,
            },
        ];
    }
}
