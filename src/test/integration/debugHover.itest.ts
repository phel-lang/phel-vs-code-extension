// What debug hover asks the adapter to evaluate.
//
// The evaluatable-expression provider is registered behind `phel.debug.enabled`
// and has no `vscode.execute*` command in most VS Code builds, so this suite
// pins what a real editor can show: that the gate is on by default and the
// extension activated behind it, and that the token shape the provider answers
// with covers a whole Phel name in a real document.
//
// Note that the fallback this replaces is *not* the `wordPattern` from
// language-configuration.json (which does understand Phel names). With no
// provider registered, debug hover splits the line on its own operator-ish
// character set — `-`, `+`, `?`, `!`, `#`, … — so `add-item` reaches the
// adapter as `add` and `blank?` as `blank`.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, openFixture, positionOf } from './helpers';
import { PHEL_SYMBOL_RE } from '../../phelSymbolToken';

const PROVIDER_COMMAND = 'vscode.executeEvaluatableExpressionProvider';

describe('debug hover expression', function () {
    let main: vscode.TextDocument;

    before(async function () {
        await activateExtension();
        main = await openFixture('src', 'app', 'main.phel');
    });

    it('is registered behind a debug adapter that is enabled by default', function () {
        assert.equal(vscode.workspace.getConfiguration('phel').get<boolean>('debug.enabled'), true);
    });

    it('covers the whole kebab-case name in a real document', function () {
        const position = positionOf(main, '(defn add-item', '(defn add-'.length);
        const whole = main.getWordRangeAtPosition(position, PHEL_SYMBOL_RE);
        assert.equal(main.getText(whole), 'add-item');
    });

    it('answers with the whole symbol where the host exposes the provider command', async function () {
        if (!(await vscode.commands.getCommands(true)).includes(PROVIDER_COMMAND)) {
            this.skip();
        }
        const position = positionOf(main, '(defn add-item', '(defn add-'.length);
        const expression = await vscode.commands.executeCommand<vscode.EvaluatableExpression>(
            PROVIDER_COMMAND,
            main.uri,
            position
        );
        assert.equal(main.getText(expression.range), 'add-item');
    });
});
