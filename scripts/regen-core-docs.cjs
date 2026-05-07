#!/usr/bin/env node
//
// Regenerates `assets/phel-core-docs.json` from a phel-lang checkout. Walks
// every `.phel` file under <root>/src/phel/, parses it with the same parser
// the extension uses at runtime (out/phelDocs.js, produced by
// `npm run compile`), and writes a JSON array.
//
// At runtime `src/phelCoreDocs.ts` lazy-loads the JSON; we don't generate
// TypeScript anymore so the bundle stays small.
//
//   node scripts/regen-core-docs.cjs /path/to/phel-lang [--phel-version v0.35.0]
//
// `--phel-version` (or env PHEL_VERSION) is used to build `View source`
// links. Defaults to `main`.

'use strict';

const fs = require('fs');
const path = require('path');

function main() {
    const args = process.argv.slice(2);
    let root = null;
    let version = process.env.PHEL_VERSION || 'main';
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--phel-version') {
            version = args[++i];
        } else if (!arg.startsWith('--')) {
            root = arg;
        } else {
            die(`unknown flag: ${arg}`);
        }
    }
    if (!root) {
        die('usage: scripts/regen-core-docs.cjs /path/to/phel-lang [--phel-version v0.35.0]');
    }

    const parserPath = path.join(__dirname, '..', 'out', 'phelDocs.js');
    if (!fs.existsSync(parserPath)) {
        die(`expected ${parserPath}; run 'npm run compile' first`);
    }
    const { parsePhelFile } = require(parserPath);

    const phelSrc = path.join(root, 'src', 'phel');
    if (!fs.existsSync(phelSrc)) {
        die(`expected ${phelSrc} to exist`);
    }

    const files = listPhelFiles(phelSrc);
    const all = [];
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf-8');
        const ns = detectNamespace(text) || namespaceForFile(file, phelSrc);
        if (!ns) continue;
        const docs = parsePhelFile(text, ns);
        const relPath = path.relative(root, file).split(path.sep).join('/');
        for (const doc of docs) {
            doc.sourceUrl = `https://github.com/phel-lang/phel-lang/blob/${version}/${relPath}`;
            all.push(doc);
        }
    }

    all.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));

    const assetsDir = path.join(__dirname, '..', 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    const out = path.join(assetsDir, 'phel-core-docs.json');
    fs.writeFileSync(out, JSON.stringify(all));

    const stats = summarise(all);
    console.error(
        `wrote ${all.length} entries across ${stats.namespaces} namespaces ` +
            `(fn=${stats.fn} macro=${stats.macro} def=${stats.def}; ` +
            `private=${stats.private})`
    );
}

function listPhelFiles(root) {
    const out = [];
    walk(root);
    out.sort();
    return out;

    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && entry.name.endsWith('.phel')) {
                out.push(full);
            }
        }
    }
}

function detectNamespace(text) {
    // First non-comment, non-whitespace form should be `(ns X ...)` or
    // `(in-ns X)`. Match either; ns names are dotted symbols.
    const re = /\((?:ns|in-ns)\s+([A-Za-z][\w.\-]*)/;
    const match = text.match(re);
    return match ? match[1] : null;
}

function namespaceForFile(file, srcRoot) {
    const rel = path.relative(srcRoot, file);
    if (rel.startsWith('..')) return null;
    const noExt = rel.replace(/\.phel$/, '');
    // src/phel/core.phel  -> phel.core
    // src/phel/core/foo.phel -> phel.core.foo
    const parts = noExt.split(path.sep);
    return ['phel', ...parts].join('.');
}

function summarise(docs) {
    const namespaces = new Set();
    let fn = 0,
        macro = 0,
        def = 0,
        priv = 0;
    for (const d of docs) {
        namespaces.add(d.ns);
        if (d.kind === 'fn') fn++;
        else if (d.kind === 'macro') macro++;
        else def++;
        if (d.private) priv++;
    }
    return { namespaces: namespaces.size, fn, macro, def, private: priv };
}

function die(msg) {
    console.error(msg);
    process.exit(1);
}

main();
