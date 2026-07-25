// Which Xdebug breakpoint ids belong to which source file.
//
// DAP's `setBreakpoints` is declarative: each request carries the *complete*
// list of breakpoints for one source, so anything the previous request
// installed and this one does not re-send has been removed in the editor and
// has to be removed in the engine too. Xdebug only removes by id, so the ids it
// hands back have to be kept.
//
// Split out of the debug adapter because that class cannot be constructed
// outside a live debug session — this part is pure, so it can be tested.

export class XdebugBreakpointRegistry {
    private readonly idsBySource = new Map<string, string[]>();

    /** Remember an id Xdebug returned for a breakpoint in `sourcePath`. */
    record(sourcePath: string, id: string): void {
        const ids = this.idsBySource.get(sourcePath);
        if (ids) {
            ids.push(id);
        } else {
            this.idsBySource.set(sourcePath, [id]);
        }
    }

    /**
     * The ids installed for `sourcePath`, forgetting them in the same step —
     * the caller is about to remove them from the engine, and a failed removal
     * should not leave an id that can never be retried against a stale session.
     */
    take(sourcePath: string): string[] {
        const ids = this.idsBySource.get(sourcePath) ?? [];
        this.idsBySource.delete(sourcePath);
        return ids;
    }

    /** Ids currently tracked for a source, without forgetting them. */
    peek(sourcePath: string): readonly string[] {
        return this.idsBySource.get(sourcePath) ?? [];
    }

    /** Forget everything, e.g. when the debug session ends. */
    clear(): void {
        this.idsBySource.clear();
    }

    /** Total tracked ids across every source. */
    get size(): number {
        let n = 0;
        for (const ids of this.idsBySource.values()) {
            n += ids.length;
        }
        return n;
    }
}
