import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension } from './helpers';

interface ContributedCommand {
    command: string;
}

interface Walkthrough {
    id: string;
    steps: unknown[];
}

describe('activation', function () {
    let extension: vscode.Extension<unknown>;

    before(async function () {
        extension = await activateExtension();
    });

    it('activates in a real editor host', function () {
        assert.equal(extension.isActive, true);
    });

    it('registers every command it contributes', async function () {
        const contributed: ContributedCommand[] = extension.packageJSON.contributes?.commands ?? [];
        assert.ok(contributed.length > 0, 'package.json contributes no commands');

        const registered = new Set(await vscode.commands.getCommands(true));
        const missing = contributed.map((c) => c.command).filter((id) => !registered.has(id));
        assert.deepEqual(missing, [], `contributed but never registered: ${missing.join(', ')}`);
    });

    it('ships the Getting Started walkthrough', function () {
        // `Help: Get Started` looks the walkthrough up by id, and a step list the
        // host rejected would just come back short.
        const walkthroughs: Walkthrough[] = extension.packageJSON.contributes?.walkthroughs ?? [];
        assert.equal(walkthroughs[0]?.id, 'phel.gettingStarted');
        assert.equal(walkthroughs[0].steps.length, 7);
    });
});
