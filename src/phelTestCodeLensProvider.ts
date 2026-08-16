import * as vscode from 'vscode';
import { findDefbenches, findDeftests } from './phelTestScanner';

const ENABLED_KEY = 'tests.codeLensEnabled';
const DEBUG_KEY = 'debug.enabled';

export class PhelTestCodeLensProvider implements vscode.CodeLensProvider {
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChange.event;

    constructor() {
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration(`phel.${ENABLED_KEY}`)) {
                this._onDidChange.fire();
            }
        });
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.ProviderResult<vscode.CodeLens[]> {
        if (!isEnabled()) {
            return [];
        }

        const refs = findDeftests(document.getText());
        const lenses: vscode.CodeLens[] = [];

        if (refs.length > 0) {
            const fileLensRange = new vscode.Range(0, 0, 0, 0);
            lenses.push(
                new vscode.CodeLens(fileLensRange, {
                    title: '$(play) Run all tests in file',
                    command: 'phel.runTestsInFile',
                    arguments: [document.uri],
                })
            );
        }

        const rangeOf = (ref: { line: number; nameCol: number; name: string }): vscode.Range =>
            new vscode.Range(ref.line, ref.nameCol, ref.line, ref.nameCol + ref.name.length);

        const debuggable = isDebugEnabled();
        for (const ref of refs) {
            lenses.push(
                new vscode.CodeLens(rangeOf(ref), {
                    title: '$(play) Run test',
                    command: 'phel.runTest',
                    arguments: [document.uri, ref.name],
                })
            );
            // Only worth offering while the adapter is registered: without it
            // there is no `phel` debug type for the session to start.
            if (debuggable) {
                lenses.push(
                    new vscode.CodeLens(rangeOf(ref), {
                        title: '$(debug-alt) Debug test',
                        command: 'phel.debugTest',
                        arguments: [document.uri, ref.name],
                    })
                );
            }
        }

        // `defbench` is the 0.50 benchmark form. It has no per-name CLI entry
        // point of its own, so a single benchmark is reached by filtering.
        const benches = findDefbenches(document.getText());
        if (benches.length > 0) {
            lenses.push(
                new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
                    title: '$(dashboard) Run all benchmarks in file',
                    command: 'phel.benchFile',
                    arguments: [document.uri],
                })
            );
        }
        for (const ref of benches) {
            lenses.push(
                new vscode.CodeLens(rangeOf(ref), {
                    title: '$(dashboard) Run benchmark',
                    command: 'phel.runBenchmark',
                    arguments: [document.uri, ref.name],
                })
            );
        }

        return lenses;
    }
}

function isEnabled(): boolean {
    return vscode.workspace.getConfiguration('phel').get<boolean>(ENABLED_KEY, true);
}

function isDebugEnabled(): boolean {
    return vscode.workspace.getConfiguration('phel').get<boolean>(DEBUG_KEY, true);
}
