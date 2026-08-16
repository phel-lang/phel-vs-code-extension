// Loaded by VS Code inside the extension host (`--extensionTestsPath`). It
// builds a Mocha run over the compiled `*.itest.js` suites next to it and
// resolves when they all pass; rejecting is what fails the run.
//
// Mocha is driven programmatically rather than through the `mocha` CLI because
// this code runs inside the editor's own process, where there is no argv to
// configure and no way to hand the suites back other than by resolving.

import * as fs from 'fs';
import * as path from 'path';
import Mocha from 'mocha';

/** Which host a suite belongs to; `runTests.js` sets `PHEL_ITEST_SUITES`. */
type SuiteGroup = 'default' | 'multi-root' | 'real';

/**
 * Suites that need the two-folder host (`test-fixtures/multi-root.code-workspace`)
 * rather than the single-folder fixture. `runTests.js` launches both and says
 * which window this is; each suite runs in exactly one of them.
 */
const MULTI_ROOT_SUITES = new Set(['multiRoot.itest.js']);

/** The `real/` subdirectory holds the suites that need a workspace with a real Phel. */
const REAL_CLI_DIR = 'real';

export function run(): Promise<void> {
    const group = (process.env.PHEL_ITEST_SUITES as SuiteGroup) || 'default';
    const mocha = new Mocha({
        ui: 'bdd',
        color: true,
        // Every assertion here drives a real editor: opening documents, waiting
        // for the workspace index to finish scanning, and for the 250 ms
        // diagnostic debounces to fire. A loaded CI runner is much slower than
        // a laptop at all three. The real-CLI suites additionally wait on PHP:
        // a boot is ~1 s, and the first project-wide index several times that.
        timeout: group === 'real' ? 120_000 : 20_000,
    });

    for (const file of suiteFiles(__dirname)) {
        if (groupOf(file) === group) {
            mocha.addFile(file);
        }
    }

    return new Promise((resolve, reject) => {
        try {
            mocha.run((failures) => {
                if (failures > 0) {
                    reject(new Error(`${failures} integration test(s) failed.`));
                    return;
                }
                resolve();
            });
        } catch (err) {
            reject(err);
        }
    });
}

/** The host `file` belongs to: its directory first, then the multi-root list. */
function groupOf(file: string): SuiteGroup {
    if (path.basename(path.dirname(file)) === REAL_CLI_DIR) {
        return 'real';
    }
    return MULTI_ROOT_SUITES.has(path.basename(file)) ? 'multi-root' : 'default';
}

/**
 * Every compiled `*.itest.js` under `dir`, sorted so runs are reproducible.
 *
 * The suffix is what keeps the two suites disjoint: the unit runner globs
 * `*.test.js`, so an integration suite can sit in the same `out/` tree without
 * a second tsconfig and without either runner picking up the other's files.
 */
function suiteFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...suiteFiles(full));
        } else if (entry.name.endsWith('.itest.js')) {
            out.push(full);
        }
    }
    return out.sort();
}
