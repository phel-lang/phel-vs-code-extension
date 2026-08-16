import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension } from './helpers';

interface ContributedCommand {
    command: string;
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
});
