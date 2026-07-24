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
import { resolvePhelExecutable } from './phelExecutable';
import { PhelFormatProvider } from './phelFormatProvider';
import { PhelTestCodeLensProvider } from './phelTestCodeLensProvider';
import { PhelWorkspaceIndexer } from './phelWorkspaceIndexProvider';
import { PhelDefinitionProvider } from './phelDefinitionProvider';
import { PhelDocumentHighlightProvider } from './phelDocumentHighlight';
import { PhelReferenceProvider } from './phelReferenceProvider';
import { PhelRenameProvider } from './phelRenameProvider';
import { PhelDocumentSymbolProvider, PhelWorkspaceSymbolProvider } from './phelSymbolProviders';
import { PhelSemanticTokensProvider, SEMANTIC_LEGEND } from './phelSemanticTokens';
import { PhelUnusedLocals } from './phelUnusedLocals';
import { PhelCodeActionProvider } from './phelCodeActionsProvider';
import { PhelFoldingRangeProvider } from './phelFoldingProvider';
import { PhelSelectionRangeProvider } from './phelSelectionRangeProvider';
import { registerPareditCommands } from './phelPareditProvider';
import { registerReplCommands } from './phelReplProvider';
import { registerNreplCommands } from './phelNreplProvider';
import { registerDoctorCommands } from './phelDoctorProvider';
import { registerCliCommands } from './phelCliCommandsProvider';
import { runInTerminal } from './phelTerminal';
import { registerSelectionCommands } from './phelSelectionProvider';
import { PhelFormHighlight } from './phelFormHighlight';
import { PhelInlineValuesProvider } from './phelInlineValuesProvider';
import { PhelStatusBar } from './phelStatusBar';
import { PhelTestController } from './phelTestController';
import {
    isLanguageServerEnabled,
    isLanguageServerRunning,
    restartLanguageClient,
    startLanguageClient,
    stopLanguageClient,
} from './phelLanguageClient';
import { affectsPhelExecutable } from './phelExecutable';

let sourceMapManager: SourceMapManager;
/** Guards against registering the bundled providers twice (startup + later fallback). */
let languageProvidersRegistered = false;

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

    // Register the debug adapter (honoring the `phel.debug.enabled` toggle).
    if (vscode.workspace.getConfiguration('phel').get<boolean>('debug.enabled', true)) {
        const factory = new PhelDebugAdapterFactory();
        context.subscriptions.push(
            vscode.debug.registerDebugAdapterDescriptorFactory('phel', factory)
        );

        const configProvider = new PhelDebugConfigurationProvider();
        context.subscriptions.push(
            vscode.debug.registerDebugConfigurationProvider('phel', configProvider)
        );
    }

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

            // Toggling the server on/off swaps the entire provider stack, which
            // can't be done safely in place — ask for a reload.
            if (e.affectsConfiguration('phel.lsp.enabled')) {
                void promptReloadForLspToggle();
            } else if (
                isLanguageServerRunning() &&
                (e.affectsConfiguration('phel.lsp.command') ||
                    e.affectsConfiguration('phel.lsp.args') ||
                    affectsPhelExecutable(e))
            ) {
                // Path/args changed while the server is up — restart it so the
                // change takes effect without a reload.
                void restartLanguageClient(context);
            }
        })
    );

    // Apply initial configuration
    const config = vscode.workspace.getConfiguration('phel');
    const cacheDir = config.get<string>('cacheDirectory');
    if (cacheDir) {
        sourceMapManager.addCacheDirectory(cacheDir);
    }

    // Language intelligence (completion / hover / signature help / definition /
    // references / rename / symbols / diagnostics / formatting) is provided
    // either by the Phel language server (`phel lsp`, opt-in) or by the bundled
    // TypeScript providers (the default). We never run both, to avoid duplicate
    // completions and conflicting results.
    if (isLanguageServerEnabled()) {
        // The fallback can be triggered either at startup (server can't launch)
        // or later (server proves unusable); register the providers at most once.
        const fallBack = (): void => registerLanguageProviders(context);
        void startLanguageClient(context, { onUnrecoverable: fallBack }).then((started) => {
            if (!started) {
                console.warn(
                    'Phel language server could not start; using bundled language providers.'
                );
                fallBack();
            }
        });
    } else {
        registerLanguageProviders(context);
    }

    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider('phel', new PhelTestCodeLensProvider())
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('phel.runTest', (uri?: vscode.Uri, testName?: string) => {
            runPhelTests(uri, testName);
        }),
        vscode.commands.registerCommand('phel.runTestsInFile', (uri?: vscode.Uri) => {
            runPhelTests(uri);
        })
    );

    if (vscode.workspace.getConfiguration('phel').get<boolean>('paredit.enabled', true)) {
        registerPareditCommands(context);
    }

    if (vscode.workspace.getConfiguration('phel').get<boolean>('repl.enabled', true)) {
        registerReplCommands(context);
    }

    if (vscode.workspace.getConfiguration('phel').get<boolean>('nrepl.enabled', true)) {
        registerNreplCommands(context);
    }

    registerSelectionCommands(context);

    registerDoctorCommands(context);

    registerCliCommands(context);

    void new PhelStatusBar().start(context);

    context.subscriptions.push(new PhelTestController());
    context.subscriptions.push(new PhelFormHighlight());

    context.subscriptions.push(
        vscode.languages.registerInlineValuesProvider('phel', new PhelInlineValuesProvider())
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

export function deactivate(): Thenable<void> | undefined {
    return stopLanguageClient();
}

/**
 * `phel.lsp.enabled` switches between the language server and the bundled
 * providers; swapping the whole stack live is error-prone, so offer a reload.
 */
async function promptReloadForLspToggle(): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
        'Phel: the language-server setting changed. Reload the window to apply it.',
        'Reload Window'
    );
    if (choice === 'Reload Window') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
}

/**
 * Register the bundled TypeScript language-feature providers. Used only when
 * the Phel language server is disabled or fails to start; otherwise `phel lsp`
 * serves these features (with PHP-interop intelligence the TS providers lack).
 */
function registerLanguageProviders(context: vscode.ExtensionContext): void {
    if (languageProvidersRegistered) {
        return;
    }
    languageProvidersRegistered = true;

    const workspaceIndexer = new PhelWorkspaceIndexer();
    context.subscriptions.push(workspaceIndexer);
    void workspaceIndexer.start();

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            'phel',
            new PhelCompletionProvider(workspaceIndexer)
        )
    );

    context.subscriptions.push(
        vscode.languages.registerHoverProvider('phel', new PhelHoverProvider(workspaceIndexer))
    );

    context.subscriptions.push(
        vscode.languages.registerSignatureHelpProvider(
            'phel',
            new PhelSignatureHelpProvider(workspaceIndexer),
            '(',
            ' '
        )
    );

    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            'phel',
            new PhelDefinitionProvider(workspaceIndexer)
        )
    );

    context.subscriptions.push(
        vscode.languages.registerReferenceProvider(
            'phel',
            new PhelReferenceProvider(workspaceIndexer)
        )
    );

    context.subscriptions.push(
        vscode.languages.registerDocumentHighlightProvider(
            'phel',
            new PhelDocumentHighlightProvider()
        )
    );

    context.subscriptions.push(
        vscode.languages.registerRenameProvider('phel', new PhelRenameProvider(workspaceIndexer))
    );

    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider('phel', new PhelDocumentSymbolProvider())
    );

    context.subscriptions.push(
        vscode.languages.registerWorkspaceSymbolProvider(
            new PhelWorkspaceSymbolProvider(workspaceIndexer)
        )
    );

    context.subscriptions.push(
        vscode.languages.registerDocumentSemanticTokensProvider(
            'phel',
            new PhelSemanticTokensProvider(),
            SEMANTIC_LEGEND
        )
    );

    context.subscriptions.push(new PhelUnusedLocals());

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            'phel',
            new PhelCodeActionProvider(workspaceIndexer),
            { providedCodeActionKinds: PhelCodeActionProvider.kinds }
        )
    );

    context.subscriptions.push(
        vscode.languages.registerFoldingRangeProvider('phel', new PhelFoldingRangeProvider())
    );

    context.subscriptions.push(
        vscode.languages.registerSelectionRangeProvider('phel', new PhelSelectionRangeProvider())
    );

    workspaceIndexer.onDidChange(() => {
        // Trigger re-evaluation of the active doc so providers refresh.
        if (vscode.window.activeTextEditor?.document.languageId === 'phel') {
            vscode.commands
                .executeCommand('editor.action.triggerSuggest')
                .then(undefined, () => undefined);
        }
    });

    registerDiagnostics(context);

    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider('phel', new PhelFormatProvider())
    );
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

function runPhelTests(uri?: vscode.Uri, testName?: string): void {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) {
        vscode.window.showWarningMessage('Open a .phel test file first.');
        return;
    }
    const folder = vscode.workspace.getWorkspaceFolder(target);
    const command = resolvePhelExecutable('test.command', folder);
    const cwd = folder?.uri.fsPath ?? path.dirname(target.fsPath);
    const filePath = path.relative(cwd, target.fsPath) || target.fsPath;
    const args = ['test'];
    if (testName) {
        // `--filter` is a regex; anchor and escape so "foo" doesn't also match
        // "foobar" (matches the Test Explorer's exact-name behavior).
        const escaped = testName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        args.push('--filter', `^${escaped}$`);
    }
    args.push(filePath);
    runInTerminal('Phel Tests', command, args, cwd);
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
