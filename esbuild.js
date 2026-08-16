// Bundle the extension into `dist/` so the published vsix stays small and
// activation stays fast. `vscode` is always externalised; it is provided by
// the editor host at runtime.
//
// The 1300-entry symbol DB used to live in `src/phelCoreDocs.ts` (~460 KB
// embedded as a JS literal) and was the dominant chunk of the bundle. It now
// ships as a sibling JSON file (`assets/phel-core-docs.json` ->
// `dist/phel-core-docs.json`) and is lazy-loaded at first use; this build
// step copies it so the runtime loader can find it next to `extension.js`.
//
// Three entry points, not one. Two subsystems dominated what was left, and
// neither runs on a normal activation:
//
//   * `phelLanguageClient` pulls in `vscode-languageclient` (~350 KB, 68% of
//     the old single-file bundle) and only runs when `phel.lsp.enabled` is on,
//     which it is not by default;
//   * `phelDebugAdapter` pulls in `@vscode/debugadapter` and the source-map
//     machinery (~55 KB) and only runs once a debug session starts.
//
// The `lazy-entries` plugin marks both as external when `src/extension.ts`
// imports them, so `dist/extension.js` keeps a runtime `import()` of the
// sibling bundle instead of inlining it. Module names are identical under
// `out/` (tsc, F5 development host) and `dist/` (esbuild, what ships), so the
// same source loads the same way in both trees.

const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const OUT_DIR = 'dist';
const MAIN_ENTRY = 'src/extension.ts';
const LAZY_ENTRIES = ['src/phelLanguageClient.ts', 'src/phelDebugAdapter.ts'];

const copyAssetsPlugin = {
    name: 'copy-assets',
    setup(build) {
        const out = build.initialOptions.outdir;
        const assets = [{ from: 'assets/phel-core-docs.json', to: 'phel-core-docs.json' }];
        build.onEnd(() => {
            fs.mkdirSync(out, { recursive: true });
            for (const a of assets) {
                if (!fs.existsSync(a.from)) {
                    console.warn(`[copy-assets] missing source ${a.from}`);
                    continue;
                }
                fs.copyFileSync(a.from, path.join(out, a.to));
            }
        });
    },
};

// Keep the lazily loaded subsystems out of the main bundle. Only the main
// entry defers them: anything else importing them (including the entries
// themselves) resolves normally, so each secondary bundle stays self-contained.
const lazyEntriesPlugin = {
    name: 'lazy-entries',
    setup(build) {
        build.onResolve({ filter: /^\.\/phel(LanguageClient|DebugAdapter)\.js$/ }, (args) => {
            if (path.resolve(args.importer) !== path.resolve(MAIN_ENTRY)) {
                return null;
            }
            return { path: args.path, external: true };
        });
    },
};

// `npm run bundle:report` reads this back to show what each bundle is made of.
const writeMetafilePlugin = {
    name: 'write-metafile',
    setup(build) {
        const out = build.initialOptions.outdir;
        build.onEnd((result) => {
            if (!result.metafile) {
                return;
            }
            fs.mkdirSync(out, { recursive: true });
            fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify(result.metafile));
        });
    },
};

const ctx = esbuild.context({
    entryPoints: [MAIN_ENTRY, ...LAZY_ENTRIES],
    bundle: true,
    outdir: OUT_DIR,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    external: ['vscode'],
    sourcemap: !production,
    minify: production,
    metafile: true,
    logLevel: 'info',
    plugins: [lazyEntriesPlugin, copyAssetsPlugin, writeMetafilePlugin],
});

if (watch) {
    ctx.then((c) => c.watch()).catch(() => process.exit(1));
} else {
    ctx.then((c) => c.rebuild().then(() => c.dispose())).catch(() => process.exit(1));
}
