// The migration hints, and the one thing about them that needs a CLI: the
// severity of a deprecation follows the project's `warn-deprecations`, which
// only `phel config` can answer. Since 0.52 removed the four superseded forms,
// a workspace `:deprecated` definition is the case that still flips.
//
// `PhelProjectConfigProvider` is instantiated directly for the parse assertion
// — the extension's own instance is private to the bundle — but the severity
// flip goes through the extension's: rewriting `phel-config.php` on disk has to
// reach the watcher, the CLI, and every open buffer's diagnostics.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { PhelProjectConfigProvider } from '../../../phelProjectConfigProvider';
import {
    activateExtension,
    openProject,
    positionOf,
    projectFolder,
    readProjectFile,
    waitFor,
    writeProjectFile,
} from './support';

const MIGRATION_CODE = 'phel-migration';
/** `migrationMessage` for the `php/new` entry, removed as source in 0.52. */
const PHP_NEW = '`php/new` was removed in Phel 0.52';
/** `migrationMessage` for the `push` entry, removed in 0.50. */
const PUSH = '`push` was removed in Phel 0.50';
/** `deprecatedDefinitionMessage` for the workspace's own `:deprecated` defn. */
const OLD_GREET = '`old-greet` is deprecated (since 0.49.0). Use `greet-v2` instead.';

function migrationDiagnostic(uri: vscode.Uri, startsWith: string): vscode.Diagnostic | undefined {
    return vscode.languages
        .getDiagnostics(uri)
        .find((d) => d.code === MIGRATION_CODE && d.message.startsWith(startsWith));
}

describe('migration hints against the project’s own configuration', function () {
    let legacy: vscode.TextDocument;
    let deprecatedApi: vscode.TextDocument;
    let originalConfig: string;

    before(async function () {
        await activateExtension();
        legacy = await openProject('src', 'legacy.phel');
        deprecatedApi = await openProject('src', 'deprecated_api.phel');
        originalConfig = await readProjectFile('phel-config.php');
    });

    after(async function () {
        await writeProjectFile(originalConfig, 'phel-config.php');
    });

    it('reads the effective configuration out of `phel config --format=json`', async function () {
        const provider = new PhelProjectConfigProvider();
        try {
            const config = await provider.get(projectFolder());
            assert.ok(config, '`phel config --format=json` produced no configuration');
            assert.deepEqual(config.srcDirs, ['src']);
            assert.deepEqual(config.testDirs, ['tests']);
            assert.deepEqual(config.formatDirs, ['src', 'tests']);
            assert.equal(config.vendorDir, 'vendor');
            assert.equal(config.cacheDir, '.phel/cache');
            assert.equal(config.warnDeprecations, false);
        } finally {
            provider.dispose();
        }
    });

    it('warns about both removals, whatever warn-deprecations says', async function () {
        const alias = await waitFor(
            'the `push` migration warning',
            () => migrationDiagnostic(legacy.uri, PUSH),
            30_000
        );
        assert.equal(alias.severity, vscode.DiagnosticSeverity.Warning);

        // `php/new` stopped being a deprecation in 0.52: it is a `PHEL012`
        // error now, so it is a warning here whether or not the flag is on.
        const superseded = await waitFor(
            'the `php/new` migration warning',
            () => migrationDiagnostic(legacy.uri, PHP_NEW),
            30_000
        );
        assert.equal(superseded.severity, vscode.DiagnosticSeverity.Warning);
        assert.equal(superseded.tags, undefined);
    });

    it('keeps a workspace deprecation a hint until the project turns warn-deprecations on', async function () {
        const hint = await waitFor(
            'the `old-greet` deprecation hint',
            () => migrationDiagnostic(deprecatedApi.uri, OLD_GREET),
            30_000
        );
        assert.equal(
            hint.severity,
            vscode.DiagnosticSeverity.Hint,
            'warn-deprecations is off, so the compiler would say nothing about this'
        );

        await writeProjectFile(
            originalConfig.replace(
                '->withOptimizationLevel(2)',
                '->withWarnDeprecations(true)\n    ->withOptimizationLevel(2)'
            ),
            'phel-config.php'
        );

        await waitFor(
            'the `old-greet` hint to become a warning',
            () => {
                const found = migrationDiagnostic(deprecatedApi.uri, OLD_GREET);
                return found?.severity === vscode.DiagnosticSeverity.Warning ? found : undefined;
            },
            90_000
        );

        await writeProjectFile(originalConfig, 'phel-config.php');
        await waitFor(
            'the `old-greet` warning to go back to a hint',
            () => {
                const found = migrationDiagnostic(deprecatedApi.uri, OLD_GREET);
                return found?.severity === vscode.DiagnosticSeverity.Hint ? found : undefined;
            },
            90_000
        );
    });

    it('flags a call to a `:deprecated` definition the workspace declares', async function () {
        const diagnostic = await waitFor(
            'the `old-greet` deprecation',
            () => migrationDiagnostic(deprecatedApi.uri, OLD_GREET),
            30_000
        );
        assert.deepEqual(diagnostic.tags, [vscode.DiagnosticTag.Deprecated]);
        // The call site, not the `defn` that carries the metadata.
        assert.equal(
            diagnostic.range.start.line,
            positionOf(deprecatedApi, '(old-greet "Phel")', 1).line
        );
    });

    it('offers the push -> conj quick fix on the real project', async function () {
        const position = positionOf(legacy, '(push xs x)', 1);
        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
            'vscode.executeCodeActionProvider',
            legacy.uri,
            new vscode.Range(position, position)
        );

        const fix = actions.find((a) => a.title === "Replace 'push' with 'conj'");
        assert.ok(
            fix?.edit,
            `no push -> conj fix among: ${actions.map((a) => a.title).join(', ')}`
        );
        assert.equal(await vscode.workspace.applyEdit(fix.edit), true);
        assert.ok(legacy.getText().includes('(conj xs x)'), 'the buffer still reads `push`');

        // Never saved; drop the edit so the rest of the run sees `push` again.
        await vscode.window.showTextDocument(legacy, { preview: false });
        await vscode.commands.executeCommand('workbench.action.files.revert');
    });
});
