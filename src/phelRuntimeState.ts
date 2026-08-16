// What the Phel processes behind the editor are doing, in one place: the
// analysis daemon (one per workspace folder), the nREPL connection (one per
// workspace folder), and the language server (one per window). The status bar
// renders it, `phel.status.describe` returns it, and every subsystem that owns
// a process publishes into it.
//
// A hub rather than direct wiring, because nothing controls the order those
// subsystems appear in: the status bar exists from activation, the daemon owner
// only once the bundled providers are registered - which can be much later,
// when the language server proves unusable - and an nREPL connection only when
// someone asks for one. A module singleton is order-independent by
// construction.
//
// Setting a state to what it already is fires no event: the daemon reports
// `running`/`idle` around every request, and a burst of keystrokes must not
// become a burst of status-bar rewrites.
//
// Kept free of `vscode` so the transitions and the rendering can be unit
// tested. Folder keys are opaque strings; the callers pass
// `folder.uri.toString()`.

/** `off` also covers "never started" and "stopped by the restart command". */
export type DaemonState = 'off' | 'idle' | 'running' | 'unavailable' | 'exhausted';

/** `attached` is `connected` to a server the user started (see `.nrepl-port`). */
export type NreplState = 'disconnected' | 'connecting' | 'connected' | 'attached';

/** `fallback` is "the server is out, the bundled providers took over". */
export type LspState = 'disabled' | 'starting' | 'running' | 'stopped' | 'fallback';

export type PhelRuntimeKind = 'daemon' | 'nrepl' | 'lsp';

interface StateByKind {
    daemon: DaemonState;
    nrepl: NreplState;
    lsp: LspState;
}

/** The state type a given kind carries, so `set` cannot mix the vocabularies. */
export type PhelRuntimeStateOf<K extends PhelRuntimeKind> = StateByKind[K];

export interface PhelRuntimeSnapshot {
    daemon: Record<string, DaemonState>;
    nrepl: Record<string, NreplState>;
    lsp: Record<string, LspState>;
}

export type PhelRuntimeListener = (snapshot: PhelRuntimeSnapshot) => void;

const NS_ICON = '$(symbol-namespace)';
const DAEMON_ICON = '$(pulse)';
const NREPL_ICON = '$(plug)';
const LSP_ICON = '$(server)';

/** What the status bar shows when the file has no `(ns …)` form. */
const NO_NS = 'Phel';

export class PhelRuntimeState {
    private readonly states = {
        daemon: new Map<string, DaemonState>(),
        nrepl: new Map<string, NreplState>(),
        lsp: new Map<string, LspState>(),
    };
    private readonly listeners = new Set<PhelRuntimeListener>();

    /** Publish `state` for `folderKey`. Setting it to what it is does nothing. */
    set<K extends PhelRuntimeKind>(kind: K, folderKey: string, state: PhelRuntimeStateOf<K>): void {
        const map = this.states[kind] as Map<string, PhelRuntimeStateOf<K>>;
        if (map.get(folderKey) === state) {
            return;
        }
        map.set(folderKey, state);
        this.emit();
    }

    /** `undefined` when nothing ever published for that folder. */
    get<K extends PhelRuntimeKind>(kind: K, folderKey: string): PhelRuntimeStateOf<K> | undefined {
        return (this.states[kind] as Map<string, PhelRuntimeStateOf<K>>).get(folderKey);
    }

    snapshot(): PhelRuntimeSnapshot {
        return {
            daemon: Object.fromEntries(this.states.daemon),
            nrepl: Object.fromEntries(this.states.nrepl),
            lsp: Object.fromEntries(this.states.lsp),
        };
    }

    /** Subscribe; the returned function unsubscribes. */
    onDidChange(listener: PhelRuntimeListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(): void {
        if (this.listeners.size === 0) {
            return;
        }
        const snapshot = this.snapshot();
        // A copy: a listener that unsubscribes itself must not skip the next one.
        for (const listener of [...this.listeners]) {
            listener(snapshot);
        }
    }
}

/** The hub every publisher and the status bar share. */
export const phelRuntimeState = new PhelRuntimeState();

/**
 * The status-bar text: the namespace (or `Phel`), followed by one icon per
 * subsystem that is up. `activeFolderKey` is the folder of the file being
 * edited; without one - or for a folder nothing published about - any folder
 * being up lights the icon, since the item then stands for the whole window.
 */
export function renderStatusText(
    nsName: string | undefined,
    snapshot: PhelRuntimeSnapshot,
    activeFolderKey?: string
): string {
    const icons: string[] = [];
    if (isUp(snapshot.daemon, activeFolderKey, isDaemonUp)) {
        icons.push(DAEMON_ICON);
    }
    if (isUp(snapshot.nrepl, activeFolderKey, isNreplUp)) {
        icons.push(NREPL_ICON);
    }
    if (isUp(snapshot.lsp, activeFolderKey, isLspUp)) {
        icons.push(LSP_ICON);
    }
    return [`${NS_ICON} ${nsName ?? NO_NS}`, ...icons].join(' ');
}

/** One line per subsystem, naming the folder only when there is more than one. */
export function renderStatusTooltip(snapshot: PhelRuntimeSnapshot): string {
    return [
        `Analysis daemon: ${describe(snapshot.daemon, 'off')}`,
        `nREPL: ${describe(snapshot.nrepl, 'disconnected')}`,
        `Language server: ${describe(snapshot.lsp, 'disabled')}`,
    ].join('\n');
}

/** True while the daemon has a process the next request can go to. */
export function isDaemonUp(state: DaemonState): boolean {
    return state === 'running' || state === 'idle';
}

/** True while ops can be sent, however the connection was obtained. */
export function isNreplUp(state: NreplState): boolean {
    return state === 'connected' || state === 'attached';
}

/** True only while the server is serving; `starting` is not yet an answer. */
export function isLspUp(state: LspState): boolean {
    return state === 'running';
}

/**
 * The state to show for the active folder: its own when something published
 * about it, otherwise any other folder that is up - the status-bar item stands
 * for the window when it cannot stand for one folder.
 */
export function stateFor<T>(
    record: Record<string, T>,
    activeFolderKey: string | undefined,
    up: (state: T) => boolean
): T | undefined {
    const active = activeFolderKey === undefined ? undefined : record[activeFolderKey];
    return active ?? Object.values(record).find(up);
}

function isUp<T>(
    record: Record<string, T>,
    activeFolderKey: string | undefined,
    up: (state: T) => boolean
): boolean {
    const state = stateFor(record, activeFolderKey, up);
    return state !== undefined && up(state);
}

function describe<T extends string>(record: Record<string, T>, fallback: T): string {
    const entries = Object.entries(record);
    if (entries.length === 0) {
        return fallback;
    }
    if (entries.length === 1) {
        return entries[0][1];
    }
    return entries.map(([key, state]) => `${state} (${folderLabel(key)})`).join(', ');
}

/** Last segment of a folder uri, which is the folder name a user recognises. */
function folderLabel(folderKey: string): string {
    const segments = folderKey.split('/').filter((segment) => segment.length > 0);
    const last = segments[segments.length - 1] ?? folderKey;
    try {
        return decodeURIComponent(last);
    } catch {
        return last;
    }
}
