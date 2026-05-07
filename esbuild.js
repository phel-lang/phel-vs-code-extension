// Bundle src/extension.ts (and the compiled debug adapter) into a single
// runtime file so the published vsix stays small and activation stays fast.
// `vscode` is always externalised — it is provided by the editor host at
// runtime.

const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

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
});

if (watch) {
    ctx.then((c) => c.watch()).catch(() => process.exit(1));
} else {
    ctx.then((c) => c.rebuild().then(() => c.dispose())).catch(() => process.exit(1));
}
