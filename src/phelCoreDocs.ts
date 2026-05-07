// Lazy loader for the generated `phel-core-docs.json` symbol corpus.
//
// The data ships as a sibling file to `extension.js` / `phelCoreDocs.js`
// (or from the repo's `assets/` folder during local dev / tests). We
// resolve on first call and cache, so the bundle stays small and there's
// no parse cost until someone actually triggers hover / completion / etc.
//
// Regenerate with: `npm run regen-docs -- /path/to/phel-lang [--phel-version vX]`.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PhelDoc } from './phelDocs';

const FILE = 'phel-core-docs.json';

let cached: readonly PhelDoc[] | null = null;

function candidatePaths(): string[] {
    const here = __dirname;
    return [
        // Bundled prod: dist/extension.js sits next to dist/phel-core-docs.json.
        path.join(here, FILE),
        // Local dev: out/phelCoreDocs.js -> ../assets/phel-core-docs.json.
        path.join(here, '..', 'assets', FILE),
        // Out-tree tests: out/test/foo.js -> ../../assets/phel-core-docs.json.
        path.join(here, '..', '..', 'assets', FILE),
    ];
}

function loadFromDisk(): readonly PhelDoc[] {
    for (const candidate of candidatePaths()) {
        try {
            const buf = fs.readFileSync(candidate, 'utf-8');
            return JSON.parse(buf) as readonly PhelDoc[];
        } catch (err: unknown) {
            const code = (err as NodeJS.ErrnoException)?.code;
            if (code !== 'ENOENT' && code !== 'ENOTDIR') {
                throw err;
            }
        }
    }
    return [];
}

function getDocs(): readonly PhelDoc[] {
    if (cached === null) {
        cached = loadFromDisk();
    }
    return cached;
}

/**
 * The PHEL_DOCS corpus. A `Proxy` defers the disk read until the first
 * time the array is iterated / indexed; importing this module is free.
 */
export const PHEL_DOCS: readonly PhelDoc[] = new Proxy([] as readonly PhelDoc[], {
    get(_target, prop, receiver) {
        const docs = getDocs();
        return Reflect.get(docs as object, prop, receiver);
    },
    has(_target, prop) {
        return Reflect.has(getDocs() as object, prop);
    },
    ownKeys() {
        return Reflect.ownKeys(getDocs() as object);
    },
    getOwnPropertyDescriptor(_target, prop) {
        return Reflect.getOwnPropertyDescriptor(getDocs() as object, prop);
    },
});
