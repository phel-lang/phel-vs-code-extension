// The runtime-state hub and the two renderers behind the status bar.
//
// The transitions matter because every publisher fires them from an event
// handler it does not control the rate of - the daemon reports around every
// request, which is every 500 ms while you type - so "setting a state to what
// it already is changes nothing" is the property the status bar depends on.

import * as assert from 'node:assert/strict';
import {
    PhelRuntimeState,
    type PhelRuntimeSnapshot,
    renderStatusText,
    renderStatusTooltip,
} from '../phelRuntimeState';

const FOLDER = 'file:///home/dev/app';
const OTHER = 'file:///home/dev/lib';

function snapshot(parts: Partial<PhelRuntimeSnapshot> = {}): PhelRuntimeSnapshot {
    return { daemon: {}, nrepl: {}, lsp: {}, ...parts };
}

describe('PhelRuntimeState', () => {
    it('reads back what was published, per kind and per folder', () => {
        const state = new PhelRuntimeState();

        state.set('daemon', FOLDER, 'running');
        state.set('nrepl', FOLDER, 'attached');
        state.set('lsp', FOLDER, 'fallback');
        state.set('daemon', OTHER, 'off');

        assert.equal(state.get('daemon', FOLDER), 'running');
        assert.equal(state.get('nrepl', FOLDER), 'attached');
        assert.equal(state.get('lsp', FOLDER), 'fallback');
        assert.equal(state.get('daemon', OTHER), 'off');
        assert.equal(state.get('nrepl', OTHER), undefined, 'nothing published for that folder');
    });

    it('notifies on every change, with the snapshot', () => {
        const state = new PhelRuntimeState();
        const seen: PhelRuntimeSnapshot[] = [];
        state.onDidChange((snap) => seen.push(snap));

        state.set('daemon', FOLDER, 'running');
        state.set('daemon', FOLDER, 'idle');

        assert.deepEqual(
            seen.map((s) => s.daemon[FOLDER]),
            ['running', 'idle']
        );
    });

    it('fires nothing when the state does not change', () => {
        const state = new PhelRuntimeState();
        let changes = 0;
        state.onDidChange(() => changes++);

        state.set('daemon', FOLDER, 'running');
        state.set('daemon', FOLDER, 'running');
        state.set('daemon', FOLDER, 'running');

        assert.equal(changes, 1, 'three identical sets are one change');
    });

    it('keeps the kinds apart', () => {
        const state = new PhelRuntimeState();
        let changes = 0;
        state.onDidChange(() => changes++);

        state.set('daemon', FOLDER, 'off');
        // Same folder, same word, different kind: still a change.
        state.set('lsp', FOLDER, 'disabled');

        assert.equal(changes, 2);
        assert.equal(state.get('daemon', FOLDER), 'off');
    });

    it('stops notifying once unsubscribed', () => {
        const state = new PhelRuntimeState();
        let changes = 0;
        const off = state.onDidChange(() => changes++);

        state.set('nrepl', FOLDER, 'connecting');
        off();
        state.set('nrepl', FOLDER, 'connected');

        assert.equal(changes, 1);
    });

    it('hands out a snapshot the caller cannot write back through', () => {
        const state = new PhelRuntimeState();
        state.set('daemon', FOLDER, 'idle');

        const taken = state.snapshot();
        taken.daemon[FOLDER] = 'exhausted';

        assert.equal(state.get('daemon', FOLDER), 'idle');
    });
});

describe('renderStatusText', () => {
    it('shows the namespace, or Phel when there is none', () => {
        assert.equal(renderStatusText('app\\core', snapshot()), '$(symbol-namespace) app\\core');
        assert.equal(renderStatusText(undefined, snapshot()), '$(symbol-namespace) Phel');
    });

    it('adds one icon per subsystem that is up in the active folder', () => {
        const snap = snapshot({
            daemon: { [FOLDER]: 'idle' },
            nrepl: { [FOLDER]: 'attached' },
            lsp: { [FOLDER]: 'running' },
        });

        assert.equal(
            renderStatusText('app\\core', snap, FOLDER),
            '$(symbol-namespace) app\\core $(pulse) $(plug) $(server)'
        );
    });

    it('leaves out the ones that are down', () => {
        const snap = snapshot({
            daemon: { [FOLDER]: 'unavailable' },
            nrepl: { [FOLDER]: 'connecting' },
            lsp: { [FOLDER]: 'fallback' },
        });

        assert.equal(renderStatusText('app\\core', snap, FOLDER), '$(symbol-namespace) app\\core');
    });

    it('answers for the active folder, not for its neighbour', () => {
        const snap = snapshot({ daemon: { [FOLDER]: 'off', [OTHER]: 'running' } });

        assert.equal(renderStatusText(undefined, snap, FOLDER), '$(symbol-namespace) Phel');
        assert.equal(renderStatusText(undefined, snap, OTHER), '$(symbol-namespace) Phel $(pulse)');
    });

    it('stands for the window when no folder is active', () => {
        const snap = snapshot({ daemon: { [OTHER]: 'running' } });

        assert.equal(renderStatusText(undefined, snap), '$(symbol-namespace) Phel $(pulse)');
    });
});

describe('renderStatusTooltip', () => {
    it('names every subsystem, even the ones nothing published about', () => {
        assert.equal(
            renderStatusTooltip(snapshot()),
            ['Analysis daemon: off', 'nREPL: disconnected', 'Language server: disabled'].join('\n')
        );
    });

    it('reports the state alone while there is one folder', () => {
        const snap = snapshot({
            daemon: { [FOLDER]: 'running' },
            nrepl: { [FOLDER]: 'attached' },
            lsp: { [FOLDER]: 'starting' },
        });

        assert.equal(
            renderStatusTooltip(snap),
            ['Analysis daemon: running', 'nREPL: attached', 'Language server: starting'].join('\n')
        );
    });

    it('names the folders once there is more than one', () => {
        const snap = snapshot({ daemon: { [FOLDER]: 'idle', [OTHER]: 'off' } });

        assert.match(renderStatusTooltip(snap), /^Analysis daemon: idle \(app\), off \(lib\)$/m);
    });
});
