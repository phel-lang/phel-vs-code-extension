// The language-feature providers, driven through the same `vscode.execute*`
// commands the editor itself uses. What the unit tests cannot show is that the
// providers are registered against the `phel` language at all, and that the
// workspace index reaches them: `greet` is defined in `src/app/core.phel` and
// only exists here because the indexer scanned the fixture workspace.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, labelOf, openFixture, positionOf, waitFor } from './helpers';

describe('language features', function () {
    let main: vscode.TextDocument;
    let core: vscode.TextDocument;

    before(async function () {
        await activateExtension();
        main = await openFixture('src', 'app', 'main.phel');
        core = await openFixture('src', 'app', 'core.phel');
    });

    it('completes special forms, core functions and workspace symbols', async function () {
        const items = await completionsIn(main);
        const labels = items.map(labelOf);

        assert.ok(labels.includes('defn'), 'no `defn` among the completions');
        assert.ok(labels.includes('map'), 'no `map` among the completions');
    });

    it('completes the core forms that are bootstrapped with a bare `def`', async function () {
        // `defn`, `defmacro` and `first` are `(def name {…} (fn …))` in core,
        // so the corpus records them as plain `def`s rather than as a macro or
        // a function. `defn` also has a snippet of the same name, which is what
        // hid that the provider was offering neither — hence the detail, which
        // only the completion provider's own items carry.
        const items = await completionsIn(main);
        const detailsOf = (label: string) =>
            items.filter((item) => labelOf(item) === label).map((item) => item.detail);

        assert.ok(detailsOf('defn').includes('Phel macro'), 'no corpus-backed `defn`');
        assert.ok(detailsOf('defmacro').includes('Phel macro'), 'no corpus-backed `defmacro`');
        assert.ok(detailsOf('first').includes('Phel core function'), 'no corpus-backed `first`');
        assert.ok(detailsOf('*ns*').includes('Phel core value'), 'no corpus-backed `*ns*`');
    });

    it('hovers a core function with its qualified name', async function () {
        const position = positionOf(main, '(map (fn', 1);
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
            'vscode.executeHoverProvider',
            main.uri,
            position
        );
        assert.match(hoverText(hovers), /phel\.core\/map/);
    });

    it('evaluates nothing on hover while no nREPL connection exists', async function () {
        // The nREPL hover provider is registered from activation but must stay
        // inert until the user connects: no `=> value` block, and the doc hover
        // it sits under is untouched.
        const position = positionOf(main, '(map (fn', 1);
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
            'vscode.executeHoverProvider',
            main.uri,
            position
        );
        const text = hoverText(hovers);
        assert.match(text, /phel\.core\/map/);
        // The evaluated block is a line of its own; `=>` also appears inside
        // the doc's own examples (`(map inc [1 2 3]) ; => (2 3 4)`).
        assert.doesNotMatch(text, /^=> /m, `hover evaluated without a connection: ${text}`);
    });

    it('hovers a workspace definition with the doc from its own file', async function () {
        const position = positionOf(main, '(greet person)', 1);
        const text = await waitFor('the workspace index to reach hover', async () => {
            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                main.uri,
                position
            );
            const rendered = hoverText(hovers);
            return rendered.includes('app.core/greet') ? rendered : undefined;
        });
        assert.match(text, /Greets `name` by name\./);
    });

    it('offers signature help inside a call to a workspace function', async function () {
        const position = positionOf(main, '(greet person)', '(greet '.length);
        const help = await waitFor('the workspace index to reach signature help', async () => {
            const result = await vscode.commands.executeCommand<vscode.SignatureHelp>(
                'vscode.executeSignatureHelpProvider',
                main.uri,
                position
            );
            return result && result.signatures.length > 0 ? result : undefined;
        });
        assert.equal(help.signatures[help.activeSignature].label, '(greet name)');
    });

    it('goes to the definition of a workspace symbol, in the file that defines it', async function () {
        // No `vendor/bin/phel` in the fixture, so there is no analysis daemon
        // and no project index: this is the workspace index answering, which is
        // what every install without a Phel CLI gets.
        const position = positionOf(main, '(greet person)', 1);
        const locations = await waitFor('the workspace index to reach definitions', async () => {
            const found = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeDefinitionProvider',
                main.uri,
                position
            );
            return found && found.length > 0 ? found : undefined;
        });

        assert.equal(locations[0].uri.toString(), core.uri.toString());
        assert.equal(locations[0].range.start.line, positionOf(core, '(defn greet').line);
    });

    it('lists references to a workspace symbol across the files that use it', async function () {
        const position = positionOf(main, '(greet person)', 1);
        const locations = await waitFor('the workspace index to reach references', async () => {
            const found = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                main.uri,
                position
            );
            return found && found.some((l) => l.uri.toString() === core.uri.toString())
                ? found
                : undefined;
        });

        assert.ok(
            locations.some((l) => l.uri.toString() === main.uri.toString()),
            'no reference in the file the cursor is in'
        );
    });

    it('folds every multi-line form', async function () {
        const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
            'vscode.executeFoldingRangeProvider',
            main.uri
        );
        assert.ok(ranges.length > 0, 'no folding ranges');
        // The `welcome` defn spans several lines, so its whole body folds.
        const welcomeLine = positionOf(main, '(defn welcome').line;
        assert.ok(
            ranges.some((r) => r.start === welcomeLine && r.end > welcomeLine),
            `no folding range starting at line ${welcomeLine}`
        );
    });

    it('lists document symbols for the definitions in a file', async function () {
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            core.uri
        );
        assert.deepEqual(
            symbols.map((s) => s.name),
            ['greet', 'old-greet']
        );
    });

    it('renames a local binding within its own scope', async function () {
        const position = positionOf(main, 'prefix "-> "');
        const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
            'vscode.executeDocumentRenameProvider',
            main.uri,
            position,
            'indent'
        );
        const entries = edit.entries();
        assert.equal(entries.length, 1, 'a local rename must not leave its file');
        const [uri, edits] = entries[0];
        assert.equal(uri.toString(), main.uri.toString());
        // The declaration plus its single use inside the `str` call.
        assert.deepEqual(
            edits.map((e) => e.newText),
            ['indent', 'indent']
        );
    });

    it('indents a line as it is typed, without asking the CLI', async function () {
        // An untitled buffer: the provider is registered against the language,
        // not against a file on disk, and nothing here needs a Phel project.
        const typed = await vscode.workspace.openTextDocument({
            content: '(defn f []\n',
            language: 'phel',
        });
        const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
            'vscode.executeFormatOnTypeProvider',
            typed.uri,
            new vscode.Position(1, 0),
            '\n',
            { tabSize: 2, insertSpaces: true }
        );
        assert.equal(edits?.length, 1, 'no edit for the line after a `defn` head');
        assert.equal(edits[0].newText, '  ');
        assert.deepEqual(
            [edits[0].range.start.line, edits[0].range.start.character],
            [1, 0],
            'the edit has to replace the indentation of the new line'
        );
    });

    it('has the editor asking for that at all, without the user opting in', function () {
        // `editor.formatOnType` ships off, so the provider above would never be
        // called; `contributes.configurationDefaults` turns it on for `.phel`
        // alone. Nothing else observes that the manifest block took effect.
        const onType = vscode.workspace
            .getConfiguration('editor', { uri: main.uri, languageId: 'phel' })
            .get<boolean>('formatOnType');
        assert.equal(onType, true, 'editor.formatOnType is off for .phel files');
    });

    it('produces semantic tokens for locals', async function () {
        const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
            'vscode.provideDocumentSemanticTokens',
            main.uri
        );
        assert.ok(tokens.data.length > 0, 'no semantic tokens');
    });
});

/**
 * The completion list inside the `str` call of `main.phel`. `greet` arrives
 * with the workspace index, which starts asynchronously on activation; the core
 * names are there from the first keystroke.
 */
async function completionsIn(doc: vscode.TextDocument): Promise<readonly vscode.CompletionItem[]> {
    const position = positionOf(doc, '(str prefix ', '(str prefix '.length);
    return waitFor('the workspace index to reach completion', async () => {
        const list = await vscode.commands.executeCommand<vscode.CompletionList>(
            'vscode.executeCompletionItemProvider',
            doc.uri,
            position
        );
        const found = list?.items ?? [];
        return found.some((item) => labelOf(item) === 'greet') ? found : undefined;
    });
}

function hoverText(hovers: readonly vscode.Hover[] | undefined): string {
    return (hovers ?? [])
        .flatMap((hover) => hover.contents)
        .map((content) => (typeof content === 'string' ? content : content.value))
        .join('\n');
}
