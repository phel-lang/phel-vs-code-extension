// Bundle src/extension.ts into a single runtime file so the published vsix
// stays small and activation stays fast. `vscode` is always externalised; it
// is provided by the editor host at runtime.
//
// The 1300-entry symbol DB used to live in `src/phelCoreDocs.ts` (~460 KB
// embedded as a JS literal) and was the dominant chunk of the bundle. It now
// ships as a sibling JSON file (`assets/phel-core-docs.json` ->
// `dist/phel-core-docs.json`) and is lazy-loaded at first use; this build
// step copies it so the runtime loader can find it next to `extension.js`.

const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const copyAssetsPlugin = {
    name: 'copy-assets',
    setup(build) {
        const out = path.dirname(build.initialOptions.outfile);
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

const ctx = esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    external: ['vscode'],
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
    plugins: [copyAssetsPlugin],
});

if (watch) {
    ctx.then((c) => c.watch()).catch(() => process.exit(1));
} else {
    ctx.then((c) => c.rebuild().then(() => c.dispose())).catch(() => process.exit(1));
}
