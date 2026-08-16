// Diagnostics against a real Phel: the on-save `phel lint` pass, and the
// on-type pass through a real `phel api-daemon`.
//
// The two are told apart by the code they report, which is the honest way to
// do it since both land under `source: 'phel'`. Only `phel lint` has rule-based
// findings — `phel/unused-binding` exists nowhere in the analyzer the daemon
// exposes — and only the analyzer answers while a buffer is dirty, since the
// on-save pass has not run for the unsaved text.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, openProject, type, typeAndSave, waitFor } from './support';

/** What `phel lint --format=json src/lint_me.phel` reports on v0.50. */
const LINT_CODE = 'phel/unused-binding';
const LINT_MESSAGE = "Unused binding: 'unused'.";
/** What `analyzeSource` answers for an unresolvable symbol. */
const ANALYZER_CODE = 'PHEL001';

function diagnosticWithCode(uri: vscode.Uri, code: string): vscode.Diagnostic | undefined {
    return vscode.languages.getDiagnostics(uri).find((d) => d.code === code);
}

describe('diagnostics from a real Phel CLI', function () {
    let lintMe: vscode.TextDocument;
    let scratch: vscode.TextDocument;

    before(async function () {
        await activateExtension();
        lintMe = await openProject('src', 'lint_me.phel');
        scratch = await openProject('src', 'scratch.phel');
    });

    it('squiggles what `phel lint` reports, on save', async function () {
        await typeAndSave(lintMe, '\n; saved by the integration suite\n');

        const diagnostic = await waitFor(
            `a ${LINT_CODE} diagnostic on lint_me.phel`,
            () => diagnosticWithCode(lintMe.uri, LINT_CODE),
            60_000
        );

        assert.equal(diagnostic.source, 'phel');
        assert.equal(diagnostic.message, LINT_MESSAGE);
        assert.equal(diagnostic.severity, vscode.DiagnosticSeverity.Warning);
        // `(let [used 1 / unused 2]` — the binding, not the form around it.
        assert.equal(diagnostic.range.start.line, 4);
        assert.equal(diagnostic.range.start.character, 8);
    });

    it('squiggles what the analysis daemon reports, while you type', async function () {
        // Never saved, so nothing but the daemon can have seen this text.
        await type(scratch, '\n(defn broken [] (no-such-symbol 1))\n');

        const diagnostic = await waitFor(
            `a ${ANALYZER_CODE} diagnostic on the unsaved scratch buffer`,
            () => diagnosticWithCode(scratch.uri, ANALYZER_CODE),
            60_000
        );

        assert.equal(diagnostic.severity, vscode.DiagnosticSeverity.Error);
        assert.match(diagnostic.message, /Cannot resolve symbol 'no-such-symbol'/);
    });

    // The "Phel Analysis" output channel is deliberately not asserted on:
    // `createOutputChannel` only ever makes a new one, nothing reads back what
    // was appended to it, and no API lists the channels a window has. What the
    // channel is there for — a daemon that starts, answers and restarts — is
    // what the rest of this suite observes instead.
    it('drops the daemon on restart and serves the next keystroke from a new one', async function () {
        await waitFor(
            'the live diagnostic to be there before the restart',
            () => diagnosticWithCode(scratch.uri, ANALYZER_CODE),
            60_000
        );

        await vscode.commands.executeCommand('phel.diagnostics.restartDaemon');
        assert.equal(
            diagnosticWithCode(scratch.uri, ANALYZER_CODE),
            undefined,
            'the restart left the previous findings behind'
        );

        await type(scratch, '\n; and another keystroke\n');
        await waitFor(
            'a fresh daemon to answer after the restart',
            () => diagnosticWithCode(scratch.uri, ANALYZER_CODE),
            60_000
        );
    });

    after(async function () {
        // The scratch buffer was never saved; drop the edits so the next suite
        // sees the file the fixture script wrote.
        await vscode.window.showTextDocument(scratch, { preview: false });
        await vscode.commands.executeCommand('workbench.action.files.revert');
    });
});
