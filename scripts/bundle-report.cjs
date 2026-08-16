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
//        npm run bundle:check    (same build, but assert the budgets below
//                                instead of printing — this is what CI runs)

const fs = require('node:fs');
const path = require('node:path');

const OWN_CODE = 'src/ (this extension)';

/** The bundle activation pays for; the other two are loaded on demand. */
const MAIN_BUNDLE = 'dist/extension.js';

/**
 * What `extension.js` may weigh, minified. It is 147 KB of our own code today,
 * so this leaves room to grow without leaving room for a deferred bundle to
 * come back: the smallest of those alone is 51 KB. Raise it deliberately, and
 * update the table in `docs/CONTRIBUTING.md` when you do.
 */
const MAX_MAIN_BYTES = 200_000;

/**
 * Inputs that belong in a deferred bundle. `bundle.itest.ts` makes the same
 * check inside the host, but only ever against the development build; this one
 * runs on the production metafile in CI, which is what users download.
 */
const DEFERRED_INPUT =
    /vscode-languageclient|vscode-jsonrpc|vscode-languageserver|@vscode\/debugadapter|phelDebugAdapter\.ts/;

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

/**
 * Everything wrong with the activation bundle, one message per problem, empty
 * when it is within budget. Returned rather than thrown so a single run can
 * report the size and the leak together.
 */
function check(metafile) {
    const problems = [];
    const main = metafile.outputs[MAIN_BUNDLE];
    if (!main) {
        return [`${MAIN_BUNDLE} is not in the metafile; did the build emit it?`];
    }

    if (main.bytes > MAX_MAIN_BYTES) {
        problems.push(
            `${MAIN_BUNDLE} is ${kb(main.bytes)} (${main.bytes} bytes), over the ` +
                `${MAX_MAIN_BYTES}-byte budget. Defer what grew, or raise ` +
                'MAX_MAIN_BYTES in this script on purpose.'
        );
    }

    const leaked = Object.keys(main.inputs).filter((input) => DEFERRED_INPUT.test(input));
    if (leaked.length > 0) {
        problems.push(
            `${MAIN_BUNDLE} pulls in ${leaked.join(', ')}: these belong in a deferred ` +
                'bundle, not on the activation path. A static import of ' +
                '`./phelLanguageClient` or `./phelDebugAdapter` from `src/extension.ts` ' +
                'is the usual cause.'
        );
    }
    return problems;
}

function readMetafile() {
    const metaPath = path.resolve(__dirname, '..', 'dist', 'meta.json');
    if (!fs.existsSync(metaPath)) {
        console.error(`${metaPath} is missing. Run \`npm run bundle:prod\` first.`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
}

function checkMain() {
    const metafile = readMetafile();
    const problems = check(metafile);
    for (const problem of problems) {
        console.error(problem);
    }
    if (problems.length > 0) {
        process.exit(1);
    }
    console.log(
        `${MAIN_BUNDLE} is ${kb(metafile.outputs[MAIN_BUNDLE].bytes)}, within its ` +
            `${MAX_MAIN_BYTES}-byte budget, and holds no deferred dependency.`
    );
}

function main() {
    const rows = summarize(readMetafile());
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
    if (process.argv.includes('--check')) {
        checkMain();
    } else {
        main();
    }
}

module.exports = { OWN_CODE, MAIN_BUNDLE, MAX_MAIN_BYTES, packageOf, summarize, check };
