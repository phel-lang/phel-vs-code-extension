import * as assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as vscode from 'vscode';
import { EXTENSION_ID, activateExtension } from './helpers';

interface ContributedCommand {
    command: string;
}

interface Walkthrough {
    id: string;
    steps: unknown[];
}

/**
 * What `activate()` may take. Locally it is 20-35 ms; this is 20x the top of
 * that, because an xvfb runner is 4-5x slower and the number has to stay quiet
 * on a bad day. What it does catch is the class of regression that costs a
 * whole second: parsing the symbol corpus synchronously, or spawning the CLI,
 * on the activation path. Raise it with `PHEL_ACTIVATION_BUDGET_MS` to
 * investigate a slow machine, not to make a red run green.
 */
const BUDGET_MS = Number(process.env.PHEL_ACTIVATION_BUDGET_MS ?? 750);

describe('activation', function () {
    let extension: vscode.Extension<unknown>;
    /** Undefined when something activated the extension before this suite ran. */
    let activationMs: number | undefined;

    before(async function () {
        // This suite sorts first, so in the default host it is the one that
        // sees the cold activation - which is why the measurement lives here.
        // Anything that already woke the extension makes the number meaningless
        // rather than merely small, so it is not recorded at all.
        const cold = vscode.extensions.getExtension(EXTENSION_ID)?.isActive === false;
        const started = performance.now();
        extension = await activateExtension();
        if (cold) {
            activationMs = performance.now() - started;
            console.log(`activation: ${activationMs.toFixed(1)} ms`);
        }
    });

    it('activates in a real editor host', function () {
        assert.equal(extension.isActive, true);
    });

    it('activates within its time budget', function () {
        if (activationMs === undefined) {
            this.skip(); // already active; nothing to conclude
        }
        assert.ok(
            activationMs < BUDGET_MS,
            `activate() took ${activationMs.toFixed(1)} ms, over the ${BUDGET_MS} ms budget`
        );
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
