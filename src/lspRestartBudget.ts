// Pure restart-budget tracker for the language client's close handler. Kept
// free of `vscode` so the decision logic can be unit-tested.
//
// The Phel server can exit between requests, so we restart it — but a server
// that exits immediately and repeatedly would otherwise respawn in a tight
// loop. This caps restarts within a sliding time window; once exceeded, the
// caller gives up and falls back to the bundled providers.

export class LspRestartBudget {
    private restarts = 0;
    private windowStart: number;

    constructor(
        private readonly maxRestarts: number,
        private readonly windowMs: number,
        private readonly now: () => number = Date.now
    ) {
        this.windowStart = this.now();
    }

    /**
     * Record a close and decide whether to restart. Returns `true` to restart,
     * `false` once the budget is exhausted within the current window.
     */
    shouldRestart(): boolean {
        const now = this.now();
        if (now - this.windowStart > this.windowMs) {
            this.windowStart = now;
            this.restarts = 0;
        }
        this.restarts += 1;
        return this.restarts <= this.maxRestarts;
    }

    /** Number of restarts recorded in the current window (for logging). */
    get count(): number {
        return this.restarts;
    }
}
