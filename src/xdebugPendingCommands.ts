// In-flight Xdebug commands, keyed by DBGp transaction id.
//
// Every command sent to the engine parks a promise until a response carrying
// the same `transaction_id` comes back. The connection can end first — Xdebug
// closes the socket when the script finishes, and this adapter deliberately
// keeps the session alive to serve the next request — so the parked promises
// have to be settled at that point, or the awaiting caller waits forever.
//
// Split out of the debug adapter because that class cannot be constructed
// outside a live debug session; this part is pure, so it can be tested.

type Resolver = (response: string) => void;

export class XdebugPendingCommands {
    private readonly waiting = new Map<number, Resolver>();

    /** Park a command until its response arrives. */
    add(transactionId: number, resolve: Resolver): void {
        this.waiting.set(transactionId, resolve);
    }

    /**
     * Deliver a response to the command that was waiting for it. Returns false
     * when nothing was waiting — a duplicate or late reply, which is ignored.
     */
    settle(transactionId: number, response: string): boolean {
        const resolve = this.waiting.get(transactionId);
        if (!resolve) {
            return false;
        }
        this.waiting.delete(transactionId);
        resolve(response);
        return true;
    }

    /** Drop a command without settling it — used by the timeout, which rejects. */
    abandon(transactionId: number): boolean {
        return this.waiting.delete(transactionId);
    }

    /** True while this command is still waiting for a response. */
    has(transactionId: number): boolean {
        return this.waiting.has(transactionId);
    }

    /**
     * Settle everything still waiting, with an empty response.
     *
     * Empty rather than rejected on purpose: the callers parse the response and
     * already treat "no match" as failure, so this unblocks them on the path
     * they handle. Rejecting would surface as an unhandled rejection in the
     * request handlers that await without a `try`.
     */
    settleAll(response = ''): number {
        const resolvers = [...this.waiting.values()];
        this.waiting.clear();
        for (const resolve of resolvers) {
            resolve(response);
        }
        return resolvers.length;
    }

    get size(): number {
        return this.waiting.size;
    }
}
