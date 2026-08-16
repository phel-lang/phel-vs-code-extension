// `scripts/bundle-report.cjs` attributes every input in an esbuild metafile to
// a package, which is how we watch the three bundles for a dependency creeping
// back into the one loaded on activation. The attribution is the part that can
// be wrong quietly: scoped names span two path segments and a transitive copy
// lives under its parent's `node_modules`.
//
// `--check` turns the same metafile into the CI gate — the activation bundle's
// size budget and the deferred-dependency guard — so it is exercised here
// against synthetic metafiles rather than only against whatever `dist/` holds.

import * as assert from 'node:assert/strict';
import * as path from 'node:path';

// Build tooling, so it is plain CommonJS rather than a compiled `src/` module.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { OWN_CODE, MAIN_BUNDLE, MAX_MAIN_BYTES, packageOf, summarize, check } = require(
    path.resolve(__dirname, '../../scripts/bundle-report.cjs')
);

describe('bundle report', () => {
    describe('packageOf', () => {
        it('attributes our own sources to the extension', () => {
            assert.equal(packageOf('src/extension.ts'), OWN_CODE);
            assert.equal(packageOf('src/test/integration/helpers.ts'), OWN_CODE);
        });

        it('keeps a scoped name whole', () => {
            assert.equal(
                packageOf('node_modules/@vscode/debugadapter/lib/main.js'),
                '@vscode/debugadapter'
            );
        });

        it('charges a nested copy to the package that is really bundled', () => {
            assert.equal(
                packageOf('node_modules/vscode-languageclient/node_modules/minimatch/minimatch.js'),
                'minimatch'
            );
        });
    });

    describe('summarize', () => {
        const metafile = {
            outputs: {
                'dist/extension.js': {
                    bytes: 310,
                    inputs: {
                        'src/extension.ts': { bytesInOutput: 100 },
                        'src/phelHoverProvider.ts': { bytesInOutput: 60 },
                        'node_modules/semver/index.js': { bytesInOutput: 150 },
                    },
                },
                'dist/extension.js.map': { bytes: 9000, inputs: {} },
                'dist/phelDebugAdapter.js': {
                    bytes: 40,
                    inputs: {
                        'node_modules/@vscode/debugadapter/lib/main.js': { bytesInOutput: 40 },
                    },
                },
            },
        };

        it('reports one row per JavaScript output, biggest first', () => {
            assert.deepEqual(
                summarize(metafile).map((row: { file: string }) => row.file),
                ['dist/extension.js', 'dist/phelDebugAdapter.js']
            );
        });

        it('sums a package across its files and sorts by size', () => {
            const [main] = summarize(metafile);
            assert.deepEqual(main.packages, [
                { name: OWN_CODE, bytes: 160 },
                { name: 'semver', bytes: 150 },
            ]);
        });
    });

    describe('check', () => {
        /** A metafile whose activation bundle weighs `bytes` and holds `inputs`. */
        function meta(bytes: number, inputs: string[]) {
            return {
                outputs: {
                    [MAIN_BUNDLE]: {
                        bytes,
                        inputs: Object.fromEntries(inputs.map((i) => [i, { bytesInOutput: 1 }])),
                    },
                    'dist/phelDebugAdapter.js': { bytes: 52_408, inputs: {} },
                },
            };
        }

        it('passes a bundle within budget that defers what it should', () => {
            assert.deepEqual(
                check(meta(150_044, ['src/extension.ts', 'node_modules/semver/index.js'])),
                []
            );
        });

        it('fails when the activation bundle outgrows its budget', () => {
            const [problem, ...rest] = check(meta(MAX_MAIN_BYTES + 1, ['src/extension.ts']));
            assert.deepEqual(rest, []);
            assert.match(problem, /over the 200000-byte budget/);
        });

        it('fails when a deferred dependency is back on the activation path', () => {
            const leaked = [
                'node_modules/vscode-languageclient/lib/node/main.js',
                'node_modules/@vscode/debugadapter/lib/main.js',
                'src/phelDebugAdapter.ts',
            ];
            for (const input of leaked) {
                const [problem, ...rest] = check(meta(150_044, ['src/extension.ts', input]));
                assert.deepEqual(rest, []);
                assert.ok(problem.includes(input), `${input} is not named in: ${problem}`);
            }
        });

        it('reports the size and the leak together', () => {
            assert.equal(
                check(meta(MAX_MAIN_BYTES + 1, ['node_modules/vscode-jsonrpc/lib/main.js'])).length,
                2
            );
        });

        it('fails when the build emitted no activation bundle at all', () => {
            assert.match(check({ outputs: {} })[0], /is not in the metafile/);
        });
    });
});
