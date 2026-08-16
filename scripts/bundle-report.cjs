#!/usr/bin/env node
//
// Print what each bundle in `dist/` is made of, from the metafile esbuild
// writes on every build (`dist/meta.json`, kept out of the vsix).
//
// The extension ships three bundles: `extension.js` (loaded on activation) and
// the two `extension.js` defers — `phelLanguageClient.js` (only when
// `phel.lsp.enabled` is on) and `phelDebugAdapter.js` (only once a debug
// session starts). This report is how we check that split still holds: a
// dependency that reappears in `extension.js` shows up here as a package row
// under it.
//
// Usage: npm run bundle:report   (bundles for production first, so the numbers
//                                are the ones users download)

const fs = require('node:fs');
const path = require('node:path');

const OWN_CODE = 'src/ (this extension)';

/**
 * The npm package an input belongs to, or `OWN_CODE` for our own source.
 * Scoped names count as one package, and a nested `node_modules` copy is
 * charged to the package that is really in the bundle, not to its parent.
 */
function packageOf(input) {
    const marker = 'node_modules/';
    const at = input.lastIndexOf(marker);
    if (at < 0) {
        return OWN_CODE;
    }
    const segments = input.slice(at + marker.length).split('/');
    return segments[0].startsWith('@') ? `${segments[0]}/${segments[1]}` : segments[0];
}

/**
 * One row per JavaScript output: its size and the packages inside it, biggest
 * first. Source maps and copied assets are skipped — they are not code.
 */
function summarize(metafile) {
    const rows = [];
    for (const [file, output] of Object.entries(metafile.outputs)) {
        if (!file.endsWith('.js')) {
            continue;
        }
        const byPackage = new Map();
        for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
            const name = packageOf(input);
            byPackage.set(name, (byPackage.get(name) ?? 0) + bytesInOutput);
        }
        rows.push({
            file,
            bytes: output.bytes,
            packages: [...byPackage]
                .map(([name, bytes]) => ({ name, bytes }))
                .sort((a, b) => b.bytes - a.bytes),
        });
    }
    return rows.sort((a, b) => b.bytes - a.bytes);
}

function kb(bytes) {
    return `${(bytes / 1024).toFixed(1)} KB`;
}

function main() {
    const metaPath = path.resolve(__dirname, '..', 'dist', 'meta.json');
    if (!fs.existsSync(metaPath)) {
        console.error(`${metaPath} is missing. Run \`npm run bundle:prod\` first.`);
        process.exit(1);
    }

    const rows = summarize(JSON.parse(fs.readFileSync(metaPath, 'utf-8')));
    let total = 0;
    for (const row of rows) {
        total += row.bytes;
        console.log(`${row.file}  ${kb(row.bytes)}`);
        for (const pkg of row.packages) {
            const size = kb(pkg.bytes).padStart(9);
            const share = String(Math.round((pkg.bytes / row.bytes) * 100)).padStart(3);
            console.log(`    ${size}  ${share}%  ${pkg.name}`);
        }
        console.log('');
    }
    console.log(`${rows.length} bundles, ${kb(total)} of JavaScript in total.`);
}

if (require.main === module) {
    main();
}

module.exports = { OWN_CODE, packageOf, summarize };
